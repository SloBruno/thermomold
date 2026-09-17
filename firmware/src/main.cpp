#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <MAX6675.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <cmath>

#include "sensor_readings.h"
#include "telemetry_contract.h"

namespace {
constexpr uint8_t kThermocoupleOneSckPin = 32;
constexpr uint8_t kThermocoupleOneCsPin = 21;
constexpr uint8_t kThermocoupleOneSoPin = 27;
constexpr uint8_t kThermocoupleTwoSckPin = 18;
constexpr uint8_t kThermocoupleTwoCsPin = 23;
constexpr uint8_t kThermocoupleTwoSoPin = 22;
constexpr uint8_t kLevelTriggerPin = 25;
constexpr uint8_t kLevelEchoPin = 26;
constexpr unsigned long kLevelEchoTimeoutUs = 30000;
constexpr unsigned long kDefaultReportIntervalMs = 500;
constexpr unsigned long kReconnectIntervalMs = 10000;
constexpr unsigned long kInitialRetryDelayMs = 2000;
constexpr unsigned long kMaximumRetryDelayMs = 60000;
constexpr char kConfigPath[] = "/config.json";

struct DeviceConfig {
  String deviceId;
  String endpoint;
  String deviceKey;
  unsigned long reportIntervalMs = kDefaultReportIntervalMs;
};

DeviceConfig config;
MAX6675 *thermocoupleOne = nullptr;
MAX6675 *thermocoupleTwo = nullptr;
WiFiManager wifiManager;
String pendingPayload;
unsigned long nextReportAt = 0;
unsigned long nextRetryAt = 0;
unsigned long retryDelayMs = kInitialRetryDelayMs;
unsigned long lastReconnectAttemptAt = 0;

String defaultDeviceId() {
  return "thermomold-" + String(static_cast<uint32_t>(ESP.getEfuseMac()), HEX);
}

void loadConfig() {
  config.deviceId = defaultDeviceId();
  config.endpoint = defaultTelemetryEndpoint().c_str();
  if (!LittleFS.exists(kConfigPath)) return;

  File file = LittleFS.open(kConfigPath, "r");
  if (!file) return;
  JsonDocument document;
  const DeserializationError error = deserializeJson(document, file);
  file.close();
  if (error) {
    Serial.printf("Ignoring invalid %s: %s\n", kConfigPath, error.c_str());
    return;
  }

  config.deviceId = document["deviceId"] | config.deviceId;
  const char *configuredEndpoint = document["endpoint"] | "";
  if (configuredEndpoint[0] != '\0') config.endpoint = configuredEndpoint;
  config.deviceKey = document["deviceKey"] | "";
  const unsigned long interval = document["reportIntervalMs"] | kDefaultReportIntervalMs;
  if (interval >= 1000) config.reportIntervalMs = interval;
}

bool saveConfig() {
  File file = LittleFS.open(kConfigPath, "w");
  if (!file) return false;
  JsonDocument document;
  document["deviceId"] = config.deviceId;
  document["endpoint"] = config.endpoint;
  document["deviceKey"] = config.deviceKey;
  document["reportIntervalMs"] = config.reportIntervalMs;
  const bool saved = serializeJson(document, file) > 0;
  file.close();
  return saved;
}

void provisionWiFiAndSettings() {
  char deviceId[64], endpoint[160], deviceKey[128], interval[12];
  config.deviceId.toCharArray(deviceId, sizeof(deviceId));
  config.endpoint.toCharArray(endpoint, sizeof(endpoint));
  config.deviceKey.toCharArray(deviceKey, sizeof(deviceKey));
  snprintf(interval, sizeof(interval), "%lu", config.reportIntervalMs);

  WiFiManagerParameter deviceIdField("deviceId", "Device ID", deviceId, sizeof(deviceId));
  WiFiManagerParameter endpointField("endpoint", "Telemetry endpoint", endpoint, sizeof(endpoint));
  WiFiManagerParameter deviceKeyField("deviceKey", "Device key (optional)", deviceKey, sizeof(deviceKey));
  WiFiManagerParameter intervalField("reportIntervalMs", "Report interval ms", interval, sizeof(interval));
  wifiManager.addParameter(&deviceIdField);
  wifiManager.addParameter(&endpointField);
  wifiManager.addParameter(&deviceKeyField);
  wifiManager.addParameter(&intervalField);
  wifiManager.setConfigPortalTimeout(180);

  if (!wifiManager.autoConnect("ThermoMold-Setup")) {
    Serial.println("Wi-Fi provisioning timed out; rebooting.");
    ESP.restart();
  }

  config.deviceId = deviceIdField.getValue();
  config.endpoint = endpointField.getValue();
  config.deviceKey = deviceKeyField.getValue();
  const unsigned long requestedInterval = String(intervalField.getValue()).toInt();
  if (requestedInterval >= 1000) config.reportIntervalMs = requestedInterval;
  if (!saveConfig()) Serial.println("Could not save device configuration.");
}

void configureSensor() {
  thermocoupleOne = new MAX6675(kThermocoupleOneCsPin, kThermocoupleOneSoPin,
                                kThermocoupleOneSckPin);
  thermocoupleTwo = new MAX6675(kThermocoupleTwoCsPin, kThermocoupleTwoSoPin,
                                kThermocoupleTwoSckPin);
  thermocoupleOne->begin();
  thermocoupleTwo->begin();
  pinMode(kLevelTriggerPin, OUTPUT);
  digitalWrite(kLevelTriggerPin, LOW);
  pinMode(kLevelEchoPin, INPUT);
  delay(250);  // MAX6675 conversion time after startup.
}

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  const unsigned long now = millis();
  if (now - lastReconnectAttemptAt < kReconnectIntervalMs) return;
  lastReconnectAttemptAt = now;
  WiFi.reconnect();
  Serial.println("Attempting Wi-Fi reconnect.");
}

bool postPayload(const String &payload) {
  if (config.endpoint.isEmpty()) {
    Serial.println("Telemetry endpoint is not configured; not posting.");
    return false;
  }
  if (WiFi.status() != WL_CONNECTED) return false;

  if (!hasHttpsScheme(std::string(config.endpoint.c_str()))) {
    Serial.println("Telemetry endpoint must use HTTPS; not posting.");
    return false;
  }

  HTTPClient http;
  const auto postWithClient = [&](WiFiClient &client) {
    if (!http.begin(client, config.endpoint)) {
      Serial.println("Could not initialize HTTP client.");
      return false;
    }
    http.setTimeout(10000);
    http.addHeader("Content-Type", "application/json");
    if (!config.deviceKey.isEmpty()) http.addHeader("X-Device-Key", config.deviceKey);
    const int status = http.POST(payload);
    http.end();
    if (status >= 200 && status < 300) return true;
    Serial.printf("Telemetry POST failed with HTTP status %d\n", status);
    return false;
  };

  WiFiClientSecure secureClient;
  // Render's certificate chain requires wall-clock synchronization on ESP32.
  // Encrypt transport immediately; replace with a pinned CA when NTP is available.
  secureClient.setInsecure();
  return postWithClient(secureClient);
}

void scheduleRetry() {
  nextRetryAt = millis() + retryDelayMs;
  retryDelayMs = min(retryDelayMs * 2, kMaximumRetryDelayMs);
}

unsigned long readLevelDistanceMm() {
  digitalWrite(kLevelTriggerPin, LOW);
  delayMicroseconds(2);
  digitalWrite(kLevelTriggerPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(kLevelTriggerPin, LOW);
  return distanceMmFromEchoUs(pulseIn(kLevelEchoPin, HIGH, kLevelEchoTimeoutUs));
}

void reportTemperature() {
  if (thermocoupleOne->read() != 0 || thermocoupleTwo->read() != 0) {
    Serial.printf("MAX6675 sensor error (status %u, %u); measurement discarded.\n",
                  thermocoupleOne->getStatus(), thermocoupleTwo->getStatus());
    return;
  }
  const float thermocoupleOneC = thermocoupleOne->getCelsius();
  const float thermocoupleTwoC = thermocoupleTwo->getCelsius();
  if (!isValidTemperatureReading(thermocoupleOneC) || !isValidTemperatureReading(thermocoupleTwoC)) {
    Serial.println("MAX6675 produced an invalid temperature; measurement discarded.");
    return;
  }
  const unsigned long levelDistanceMm = readLevelDistanceMm();
  if (!isValidLevelDistanceMm(levelDistanceMm)) {
    Serial.println("AJ-SR04M echo timed out; measurement discarded.");
    return;
  }
  pendingPayload = buildMultiSensorTelemetryPayload(std::string(config.deviceId.c_str()),
                                                     thermocoupleOneC, thermocoupleTwoC,
                                                     levelDistanceMm).c_str();
  if (postPayload(pendingPayload)) {
    Serial.printf("Telemetry posted: %.2f C, %.2f C, %lu mm\n", thermocoupleOneC,
                  thermocoupleTwoC, levelDistanceMm);
    pendingPayload = "";
    retryDelayMs = kInitialRetryDelayMs;
  } else {
    scheduleRetry();
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  // Format a blank/corrupted LittleFS partition so portal settings persist after reset.
  if (!LittleFS.begin(true)) Serial.println("LittleFS unavailable; settings will not persist.");
  loadConfig();
  provisionWiFiAndSettings();
  configureSensor();
  nextReportAt = millis();
}

void loop() {
  ensureWiFi();
  const unsigned long now = millis();
  if (!pendingPayload.isEmpty() && now >= nextRetryAt) {
    if (postPayload(pendingPayload)) {
      pendingPayload = "";
      retryDelayMs = kInitialRetryDelayMs;
    } else {
      scheduleRetry();
    }
  }
  if (pendingPayload.isEmpty() && now >= nextReportAt) {
    nextReportAt = now + minimumTelemetryIntervalMs();
    reportTemperature();
  }
}
