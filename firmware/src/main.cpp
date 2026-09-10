#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <MAX6675.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiManager.h>
#include <cmath>

#include "telemetry_contract.h"

namespace {
constexpr uint8_t kDefaultSckPin = 18;
constexpr uint8_t kDefaultCsPin = 5;
constexpr uint8_t kDefaultSoPin = 19;
constexpr unsigned long kDefaultReportIntervalMs = 30000;
constexpr unsigned long kReconnectIntervalMs = 10000;
constexpr unsigned long kInitialRetryDelayMs = 2000;
constexpr unsigned long kMaximumRetryDelayMs = 60000;
constexpr char kConfigPath[] = "/config.json";

struct DeviceConfig {
  String deviceId;
  String endpoint;
  String deviceKey;
  uint8_t sckPin = kDefaultSckPin;
  uint8_t csPin = kDefaultCsPin;
  uint8_t soPin = kDefaultSoPin;
  unsigned long reportIntervalMs = kDefaultReportIntervalMs;
};

DeviceConfig config;
MAX6675 *thermocouple = nullptr;
WiFiManager wifiManager;
String pendingPayload;
unsigned long nextReportAt = 0;
unsigned long nextRetryAt = 0;
unsigned long retryDelayMs = kInitialRetryDelayMs;
unsigned long lastReconnectAttemptAt = 0;

bool validPin(int value) { return value >= 0 && value <= 39; }

String defaultDeviceId() {
  return "thermomold-" + String(static_cast<uint32_t>(ESP.getEfuseMac()), HEX);
}

void loadConfig() {
  config.deviceId = defaultDeviceId();
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
  config.endpoint = document["endpoint"] | "";
  config.deviceKey = document["deviceKey"] | "";
  const int sck = document["sckPin"] | kDefaultSckPin;
  const int cs = document["csPin"] | kDefaultCsPin;
  const int so = document["soPin"] | kDefaultSoPin;
  if (validPin(sck) && validPin(cs) && validPin(so)) {
    config.sckPin = sck;
    config.csPin = cs;
    config.soPin = so;
  }
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
  document["sckPin"] = config.sckPin;
  document["csPin"] = config.csPin;
  document["soPin"] = config.soPin;
  document["reportIntervalMs"] = config.reportIntervalMs;
  const bool saved = serializeJson(document, file) > 0;
  file.close();
  return saved;
}

uint8_t readPortalPin(const char *value, uint8_t fallback) {
  const int parsed = String(value).toInt();
  return validPin(parsed) ? static_cast<uint8_t>(parsed) : fallback;
}

void provisionWiFiAndSettings() {
  char deviceId[64], endpoint[160], deviceKey[128], sck[4], cs[4], so[4], interval[12];
  config.deviceId.toCharArray(deviceId, sizeof(deviceId));
  config.endpoint.toCharArray(endpoint, sizeof(endpoint));
  config.deviceKey.toCharArray(deviceKey, sizeof(deviceKey));
  snprintf(sck, sizeof(sck), "%u", config.sckPin);
  snprintf(cs, sizeof(cs), "%u", config.csPin);
  snprintf(so, sizeof(so), "%u", config.soPin);
  snprintf(interval, sizeof(interval), "%lu", config.reportIntervalMs);

  WiFiManagerParameter deviceIdField("deviceId", "Device ID", deviceId, sizeof(deviceId));
  WiFiManagerParameter endpointField("endpoint", "Telemetry endpoint", endpoint, sizeof(endpoint));
  WiFiManagerParameter deviceKeyField("deviceKey", "Device key (optional)", deviceKey, sizeof(deviceKey));
  WiFiManagerParameter sckField("sckPin", "MAX6675 SCK GPIO", sck, sizeof(sck));
  WiFiManagerParameter csField("csPin", "MAX6675 CS GPIO", cs, sizeof(cs));
  WiFiManagerParameter soField("soPin", "MAX6675 SO GPIO", so, sizeof(so));
  WiFiManagerParameter intervalField("reportIntervalMs", "Report interval ms", interval, sizeof(interval));
  wifiManager.addParameter(&deviceIdField);
  wifiManager.addParameter(&endpointField);
  wifiManager.addParameter(&deviceKeyField);
  wifiManager.addParameter(&sckField);
  wifiManager.addParameter(&csField);
  wifiManager.addParameter(&soField);
  wifiManager.addParameter(&intervalField);
  wifiManager.setConfigPortalTimeout(180);

  if (!wifiManager.autoConnect("ThermoMold-Setup")) {
    Serial.println("Wi-Fi provisioning timed out; rebooting.");
    ESP.restart();
  }

  config.deviceId = deviceIdField.getValue();
  config.endpoint = endpointField.getValue();
  config.deviceKey = deviceKeyField.getValue();
  config.sckPin = readPortalPin(sckField.getValue(), config.sckPin);
  config.csPin = readPortalPin(csField.getValue(), config.csPin);
  config.soPin = readPortalPin(soField.getValue(), config.soPin);
  const unsigned long requestedInterval = String(intervalField.getValue()).toInt();
  if (requestedInterval >= 1000) config.reportIntervalMs = requestedInterval;
  if (!saveConfig()) Serial.println("Could not save device configuration.");
}

void configureSensor() {
  // Software SPI makes all three MAX6675 GPIO pins configurable.
  thermocouple = new MAX6675(config.csPin, config.soPin, config.sckPin);
  thermocouple->begin();
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

  WiFiClient client;
  HTTPClient http;
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
}

void scheduleRetry() {
  nextRetryAt = millis() + retryDelayMs;
  retryDelayMs = min(retryDelayMs * 2, kMaximumRetryDelayMs);
}

void reportTemperature() {
  if (thermocouple->read() != 0) {
    Serial.printf("MAX6675 sensor error (status %u); measurement discarded.\n",
                  thermocouple->getStatus());
    return;
  }
  const float temperatureC = thermocouple->getCelsius();
  if (isnan(temperatureC)) {
    Serial.println("MAX6675 produced NaN; measurement discarded.");
    return;
  }
  pendingPayload = buildTelemetryPayload(std::string(config.deviceId.c_str()), temperatureC).c_str();
  if (postPayload(pendingPayload)) {
    pendingPayload = "";
    retryDelayMs = kInitialRetryDelayMs;
  } else {
    scheduleRetry();
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  if (!LittleFS.begin(false)) Serial.println("LittleFS unavailable; settings will not persist.");
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
    nextReportAt = now + config.reportIntervalMs;
    reportTemperature();
  }
}
