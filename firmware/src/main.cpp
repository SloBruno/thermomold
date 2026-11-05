#include <Arduino.h>
#include <SPI.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <Update.h>
#include "max6675_frame.h"
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <cmath>
#include <esp_timer.h>
#include <ctime>
#include <mbedtls/sha256.h>

#include "actuators.h"
#include "pump_control.h"
#include "calibration.h"
#include "flow_filter.h"
#include "flow_calibration.h"
#include "level_filter.h"
#include "ota_update.h"
#include "sensor_readings.h"
#include "telemetry_contract.h"
#include "temperature_alarm.h"

namespace {
constexpr uint8_t kThermocoupleOneSckPin = 32;
constexpr uint8_t kThermocoupleOneCsPin = 21;
constexpr uint8_t kThermocoupleOneSoPin = 27;
constexpr uint8_t kThermocoupleTwoSckPin = 18;
constexpr uint8_t kThermocoupleTwoCsPin = 23;
constexpr uint8_t kThermocoupleTwoSoPin = 22;
constexpr uint8_t kLevelTriggerPin = 25;
constexpr uint8_t kLevelEchoPin = 26;
constexpr uint8_t kPump1RelayPin = 19;  // HW-383 IN1
constexpr uint8_t kPump2RelayPin = 33;  // HW-383 IN2
constexpr uint8_t kFlowSensorPin = 34;  // ZJ-S201 signal via 10k/20k divider
// HW-383 variants exist as active-high or active-low; flip this if a relay
// clicks ON at boot or the LEDs are inverted during the bench test.
constexpr uint8_t kRelayActiveLevel = HIGH;
constexpr unsigned long kDefaultReportIntervalMs = 500;
constexpr unsigned long kReconnectIntervalMs = 10000;
constexpr unsigned long kInitialRetryDelayMs = 2000;
constexpr unsigned long kMaximumRetryDelayMs = 60000;
constexpr char kConfigPath[] = "/config.json";
constexpr char kOtaManifestUrl[] = "https://thermomold.onrender.com/api/ota/manifest";
constexpr unsigned long kOtaCheckIntervalMs = 15UL * 60UL * 1000UL;
constexpr time_t kEarliestValidTime = 1704067200;  // 2024-01-01 UTC
#ifndef THERMOMOLD_FIRMWARE_VERSION
#define THERMOMOLD_FIRMWARE_VERSION "0.1.0"
#endif

// GTS Root R4 anchors the current Render chain (WE1 -> GTS Root R4).
// OTA clients deliberately use this CA instead of setInsecure().
constexpr char kOtaRootCa[] = R"PEM(-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
)PEM";


struct DeviceConfig {
  String deviceId;
  String endpoint;
  String deviceKey;
  unsigned long reportIntervalMs = kDefaultReportIntervalMs;
};

DeviceConfig config;
CalibrationCommand calibration;
struct Max6675Pins {
  uint8_t sck;
  uint8_t cs;
  uint8_t so;
};
constexpr Max6675Pins kThermocoupleOnePins = {kThermocoupleOneSckPin, kThermocoupleOneCsPin,
                                              kThermocoupleOneSoPin};
constexpr Max6675Pins kThermocoupleTwoPins = {kThermocoupleTwoSckPin, kThermocoupleTwoCsPin,
                                              kThermocoupleTwoSoPin};

// Hand-written MAX6675 read at ~100 kHz. The robtillaart library's zero-delay software SPI
// read MAX6675 #1 as ~110 C at room temperature (tools/max6675_diag variants A/B), while this
// timing read both modules correctly (variants C/D): CS low, wait tCSS, then sample SO with
// SCK low, each bit settling >= 5 us after the falling edge that presented it.
void configureMax6675Pins(const Max6675Pins &pins);

uint16_t readMax6675Frame(const Max6675Pins &pins) {
  // Re-assert the bus pin modes on every read so nothing configured after boot
  // (Wi-Fi, OTA, other peripherals) can leave SCK/CS/SO in another mode.
  configureMax6675Pins(pins);
  uint16_t raw = 0;
  digitalWrite(pins.sck, LOW);
  digitalWrite(pins.cs, LOW);
  delayMicroseconds(kMax6675CsSetupUs);
  for (int bit = 15; bit >= 0; --bit) {
    if (digitalRead(pins.so)) raw |= static_cast<uint16_t>(1u << bit);
    digitalWrite(pins.sck, HIGH);
    delayMicroseconds(kMax6675HalfClockUs);
    digitalWrite(pins.sck, LOW);
    delayMicroseconds(kMax6675HalfClockUs);
  }
  digitalWrite(pins.cs, HIGH);  // Raising CS starts the next conversion.
  return raw;
}

void configureMax6675Pins(const Max6675Pins &pins) {
  pinMode(pins.cs, OUTPUT);
  digitalWrite(pins.cs, HIGH);
  pinMode(pins.sck, OUTPUT);
  digitalWrite(pins.sck, LOW);
  pinMode(pins.so, INPUT);
}
WiFiManager wifiManager;
String pendingPayload;
unsigned long nextReportAt = 0;
unsigned long nextRetryAt = 0;
unsigned long retryDelayMs = kInitialRetryDelayMs;
unsigned long lastReconnectAttemptAt = 0;
unsigned long nextOtaCheckAt = 0;

bool pump1On = false;
bool pump2On = false;
PumpControl pumpControl;
SemaphoreHandle_t controlMutex;
uint32_t nextLevelBurstAt = 0;

// Shared with the flow ISR; always accessed under flowMux.
FlowPulseFilter flowFilter;
portMUX_TYPE flowMux = portMUX_INITIALIZER_UNLOCKED;
FlowMeter flowMeter;
uint32_t flowWindowStartedAt = 0;
String flowCounterEpoch;
float flowLpm = 0.0f;
SPIClass diagnosticSpiOne(HSPI);
SPIClass diagnosticSpiTwo(VSPI);
bool diagnosticHardwareSpi = false;
bool serialDiagnostics = false;
bool localDiagnosticsOnly = false;
bool forceConfigPortal = false;
uint32_t lastTemperatureReadMs = 0;
struct TemperatureSnapshot {
  uint16_t rawOne=0, rawTwo=0;
  float rawOneC=NAN, rawTwoC=NAN, oneC=NAN, twoC=NAN;
  uint32_t calibrationRevision=0;
  uint32_t sampledAt=0;
  bool acquired=false;
} temperature;
TemperatureAlarm temperatureAlarm;

uint16_t readHardwareDiagnostic(SPIClass &spi, const Max6675Pins &pins) {
  spi.beginTransaction(SPISettings(100000, MSBFIRST, SPI_MODE0));
  digitalWrite(pins.cs, LOW);
  delayMicroseconds(10);
  const uint16_t frame = spi.transfer16(0);
  digitalWrite(pins.cs, HIGH);
  spi.endTransaction();
  return frame;
}

void printTemperatureDiagnostics(uint16_t a, uint16_t b) {
  xSemaphoreTake(controlMutex, portMAX_DELAY);
  const CalibrationCommand diagnosticCalibration = calibration;
  xSemaphoreGive(controlMutex);
  Serial.printf("READER=%s ", diagnosticHardwareSpi ? "hardware" : "software");
  const auto one = decodeMax6675Frame(a);
  const auto two = decodeMax6675Frame(b);
  Serial.printf("RAW_TEMP ms=%lu hex1=0x%04X hex2=0x%04X status1=%u status2=%u rawC1=%.2f rawC2=%.2f correctedC1=%.2f correctedC2=%.2f calibrationRevision=%lu\n",
    millis(), a, b, one.status, two.status, one.celsius, two.celsius,
    applyTemperatureCalibration(one.celsius, diagnosticCalibration.sensorOne),
    applyTemperatureCalibration(two.celsius, diagnosticCalibration.sensorTwo), (unsigned long)diagnosticCalibration.revision);
}


LevelBurst levelBurst;
uint32_t levelDistanceMm = 0;   // last burst median; 0 = unavailable
uint32_t levelRawMm[kLevelSamplesPerBurst] = {0, 0, 0, 0, 0};  // last burst pings; 0 = no echo
uint32_t levelWorstPingUs = 0;  // longest single ping since boot (loop blocking)

void initializeCalibration() {
  calibration.valid = true;
  calibration.revision = 0;
  calibration.sensorOne = {{0.0f, 0.0f}, {100.0f, 100.0f}};
  calibration.sensorTwo = {{0.0f, 0.0f}, {100.0f, 100.0f}};
}

void IRAM_ATTR onFlowPulse() {
  // Same clock as micros(), but esp_timer_get_time() is IRAM-resident while this core's
  // micros() is in flash; an IRAM ISR must not touch flash (e.g. during OTA writes).
  const uint32_t nowUs = static_cast<uint32_t>(esp_timer_get_time());
  portENTER_CRITICAL_ISR(&flowMux);
  flowPulseEdge(flowFilter, nowUs);
  portEXIT_CRITICAL_ISR(&flowMux);
}

uint8_t relayLevel(bool on) {
  return on ? kRelayActiveLevel : (kRelayActiveLevel == HIGH ? LOW : HIGH);
}

void applyPumps(bool nextPump1, bool nextPump2) {
  pump1On = nextPump1;
  pump2On = nextPump2;
  digitalWrite(kPump1RelayPin, relayLevel(pump1On));
  digitalWrite(kPump2RelayPin, relayLevel(pump2On));
}

// Called first in setup(): relays must be inactive before the Wi-Fi portal,
// which can block for up to 3 minutes.
void configurePumpsOff() {
  digitalWrite(kPump1RelayPin, relayLevel(false));
  digitalWrite(kPump2RelayPin, relayLevel(false));
  pinMode(kPump1RelayPin, OUTPUT);
  pinMode(kPump2RelayPin, OUTPUT);
  applyPumps(false, false);
}

void enforcePumpFailSafe() {
  // Called only under controlMutex, including when automatic currently wants OFF.
  pumpControl.safety(millis(), WiFi.status() == WL_CONNECTED);
  applyPumps(pumpControl.pump1, pumpControl.pump2);
}

void updateFlow() {
  const uint32_t now = millis();
  const uint32_t windowMs = now - flowWindowStartedAt;
  if (windowMs < 1000) return;
  portENTER_CRITICAL(&flowMux);
  const FlowWindow window = takeFlowWindow(flowFilter, windowMs);
  portEXIT_CRITICAL(&flowMux);
  flowMeterUpdate(flowMeter, window);
  flowLpm = rawFlowLpm(window.rawEdges, windowMs);
  if (serialDiagnostics) Serial.printf("RAW_FLOW ms=%lu windowMs=%lu edges=%lu accepted=%lu rejected=%lu rawHz=%.2f filteredLpm=%.2f totalPulses=%lu\n",
    now, windowMs, window.rawEdges, window.pulses, window.rawEdges-window.pulses,
    window.rawEdges*1000.0/windowMs, flowMeter.lpm, flowMeter.totalPulses);
  flowWindowStartedAt = now;
}

String defaultDeviceId() {
  return "thermomold-" + String(static_cast<uint32_t>(ESP.getEfuseMac()), HEX);
}

bool readSensorCalibration(JsonVariantConst source, SensorCalibration &target) {
  if (source.isNull() || source["low"].isNull() || source["high"].isNull()
      || source["low"]["rawC"].isNull() || source["low"]["referenceC"].isNull()
      || source["high"]["rawC"].isNull() || source["high"]["referenceC"].isNull()) return false;
  target.low.rawC = source["low"]["rawC"] | target.low.rawC;
  target.low.referenceC = source["low"]["referenceC"] | target.low.referenceC;
  target.high.rawC = source["high"]["rawC"] | target.high.rawC;
  target.high.referenceC = source["high"]["referenceC"] | target.high.referenceC;
  return isfinite(target.low.rawC) && isfinite(target.low.referenceC) &&
         isfinite(target.high.rawC) && isfinite(target.high.referenceC) &&
         target.low.rawC != target.high.rawC;
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
  const JsonVariantConst calibrationDocument = document["calibration"];
  const uint32_t revision = calibrationDocument["revision"] | 0U;
  SensorCalibration sensorOne = calibration.sensorOne;
  SensorCalibration sensorTwo = calibration.sensorTwo;
  if (readSensorCalibration(calibrationDocument["sensors"]["max6675-1"], sensorOne) &&
      readSensorCalibration(calibrationDocument["sensors"]["max6675-2"], sensorTwo)) {
    calibration.revision = revision;
    calibration.sensorOne = sensorOne;
    calibration.sensorTwo = sensorTwo;
  }
}

bool saveConfig() {
  File file = LittleFS.open(kConfigPath, "w");
  if (!file) return false;
  JsonDocument document;
  document["deviceId"] = config.deviceId;
  document["endpoint"] = config.endpoint;
  document["deviceKey"] = config.deviceKey;
  document["reportIntervalMs"] = config.reportIntervalMs;
  document["calibration"]["revision"] = calibration.revision;
  document["calibration"]["sensors"]["max6675-1"]["low"]["rawC"] = calibration.sensorOne.low.rawC;
  document["calibration"]["sensors"]["max6675-1"]["low"]["referenceC"] = calibration.sensorOne.low.referenceC;
  document["calibration"]["sensors"]["max6675-1"]["high"]["rawC"] = calibration.sensorOne.high.rawC;
  document["calibration"]["sensors"]["max6675-1"]["high"]["referenceC"] = calibration.sensorOne.high.referenceC;
  document["calibration"]["sensors"]["max6675-2"]["low"]["rawC"] = calibration.sensorTwo.low.rawC;
  document["calibration"]["sensors"]["max6675-2"]["low"]["referenceC"] = calibration.sensorTwo.low.referenceC;
  document["calibration"]["sensors"]["max6675-2"]["high"]["rawC"] = calibration.sensorTwo.high.rawC;
  document["calibration"]["sensors"]["max6675-2"]["high"]["referenceC"] = calibration.sensorTwo.high.referenceC;
  const bool saved = serializeJson(document, file) > 0;
  file.close();
  return saved;
}

void applyCalibrationCommand(const String &body) {
  JsonDocument document;
  if (deserializeJson(document, body)) return;
  const JsonVariantConst source = document["commands"]["calibration"];
  const uint32_t revision = source["revision"] | 0U;
  xSemaphoreTake(controlMutex, portMAX_DELAY);
  const CalibrationCommand currentCalibration = calibration;
  xSemaphoreGive(controlMutex);
  if (!calibrationRevisionIsNewer(currentCalibration.revision, revision)) return;

  CalibrationCommand candidate = currentCalibration;
  candidate.revision = revision;
  if (!readSensorCalibration(source["sensors"]["max6675-1"], candidate.sensorOne) ||
      !readSensorCalibration(source["sensors"]["max6675-2"], candidate.sensorTwo)) return;
  candidate.valid = true;
  xSemaphoreTake(controlMutex, portMAX_DELAY);
  calibration = candidate;
  temperature = TemperatureSnapshot{};
  temperatureAlarm.reset(); // never combine evidence across calibration revisions
  xSemaphoreGive(controlMutex);
  if (!saveConfig()) Serial.println("Could not persist MAX6675 calibration.");
}

void provisionWiFiAndSettings() {
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.persistent(true);
  // Without a connection timeout WiFiManager can block forever while trying a
  // saved AP, leaving the ESP neither online nor back in the setup portal.
  wifiManager.setConnectTimeout(30);
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
  wifiManager.setDebugOutput(false);
  wifiManager.setAPCallback([](WiFiManager *) {
    Serial.printf("AP_STARTED name=ThermoMold-Setup address=%s\n", WiFi.softAPIP().toString().c_str());
  });

  if (forceConfigPortal) Serial.println("AP_READY_REQUEST name=ThermoMold-Setup address=192.168.4.1");
  const bool connected = forceConfigPortal ? wifiManager.startConfigPortal("ThermoMold-Setup")
                                           : wifiManager.autoConnect("ThermoMold-Setup");
  if (!connected) {
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
  configureMax6675Pins(kThermocoupleOnePins);
  configureMax6675Pins(kThermocoupleTwoPins);
  pinMode(kLevelTriggerPin, OUTPUT);
  digitalWrite(kLevelTriggerPin, LOW);
  pinMode(kLevelEchoPin, INPUT);
  pinMode(kFlowSensorPin, INPUT);  // GPIO34 is input-only; divider provides the level.
  attachInterrupt(digitalPinToInterrupt(kFlowSensorPin), onFlowPulse, FALLING);
  flowWindowStartedAt = millis();
  flowCounterEpoch = String(esp_random(), HEX) + "-" + String(esp_random(), HEX);
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

void configureOtaClock() {
  // SNTP setup is asynchronous; OTA waits for a valid wall clock rather than
  // blocking telemetry or actuator safety while time is unavailable.
  configTime(0, 0, "time.google.com", "pool.ntp.org");
}

bool hasValidOtaTime() {
  time_t now = 0;
  time(&now);
  return now >= kEarliestValidTime;
}

bool fetchOtaManifest(OtaManifest &manifest) {
  WiFiClientSecure client;
  client.setCACert(kOtaRootCa);
  HTTPClient http;
  if (!http.begin(client, kOtaManifestUrl)) {
    Serial.println("OTA manifest connection initialization failed.");
    return false;
  }
  http.setTimeout(10000);
  http.addHeader("X-Device-Key", config.deviceKey);
  const int status = http.GET();
  const String body = status == 200 ? http.getString() : String();
  http.end();
  if (status != 200) {
    Serial.printf("OTA manifest request failed with HTTP status %d\n", status);
    return false;
  }
  manifest = parseOtaManifest(std::string(body.c_str()));
  if (!manifest.valid) Serial.println("OTA manifest is invalid; keeping current firmware.");
  return manifest.valid;
}

bool downloadAndInstallOta(const OtaManifest &manifest) {
  WiFiClientSecure client;
  client.setCACert(kOtaRootCa);
  HTTPClient http;
  if (!http.begin(client, manifest.url.c_str())) {
    Serial.println("OTA download connection initialization failed.");
    return false;
  }
  http.setTimeout(10000);
  const int status = http.GET();
  const int contentLength = http.getSize();
  if (status != 200 || contentLength <= 0) {
    Serial.printf("OTA download failed (HTTP %d, size %d).\n", status, contentLength);
    http.end();
    return false;
  }
  if (!Update.begin(static_cast<size_t>(contentLength), U_FLASH)) {
    Serial.printf("OTA could not reserve update space (error %u).\n", Update.getError());
    http.end();
    return false;
  }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  bool success = mbedtls_sha256_starts_ret(&sha, 0) == 0;
  WiFiClient *stream = http.getStreamPtr();
  uint8_t buffer[1024];
  int remaining = contentLength;
  while (success && remaining > 0) {
    const size_t requested = static_cast<size_t>(min(remaining, static_cast<int>(sizeof(buffer))));
    const size_t received = stream->readBytes(buffer, requested);
    if (received == 0 || mbedtls_sha256_update_ret(&sha, buffer, received) != 0 ||
        Update.write(buffer, received) != received) {
      success = false;
      break;
    }
    remaining -= static_cast<int>(received);
  }

  uint8_t digest[32];
  if (success) success = mbedtls_sha256_finish_ret(&sha, digest) == 0;
  mbedtls_sha256_free(&sha);
  http.end();
  char digestHex[65];
  for (size_t index = 0; index < sizeof(digest); ++index) {
    snprintf(digestHex + index * 2, 3, "%02x", digest[index]);
  }
  if (!success || remaining != 0 || manifest.sha256 != digestHex) {
    Serial.println("OTA download hash mismatch or stream failure; update aborted.");
    Update.abort();
    return false;
  }
  if (!Update.end()) {
    Serial.printf("OTA finalization failed (error %u).\n", Update.getError());
    return false;
  }
  Serial.printf("OTA version %s installed; rebooting.\n", manifest.version.c_str());
  ESP.restart();
  return true;  // Unreachable after restart; documents successful Update.end().
}

void checkForOtaUpdate() {
  if (WiFi.status() != WL_CONNECTED || config.deviceKey.isEmpty() || !hasValidOtaTime()) return;
  // Never block a commanded pump or queued telemetry retry for a firmware download.
  if (!pendingPayload.isEmpty()) return;
  xSemaphoreTake(controlMutex, portMAX_DELAY);
  const bool busy = pump1On || pump2On || pumpControl.fill.enabled;
  xSemaphoreGive(controlMutex);
  if (busy) return;

  OtaManifest manifest;
  if (!fetchOtaManifest(manifest)) return;
  if (!isNewerFirmwareVersion(THERMOMOLD_FIRMWARE_VERSION, manifest.version)) {
    Serial.println("OTA firmware is already current.");
    return;
  }
  Serial.printf("OTA update available: %s -> %s\n", THERMOMOLD_FIRMWARE_VERSION,
                manifest.version.c_str());
  downloadAndInstallOta(manifest);
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
    const String body = (status >= 200 && status < 300) ? http.getString() : String();
    http.end();
    if (status < 200 || status >= 300) {
      Serial.printf("Telemetry POST failed with HTTP status %d\n", status);
      return false;
    }
    const PumpCommand command = parsePumpCommand(std::string(body.c_str()));
    applyCalibrationCommand(body);
    xSemaphoreTake(controlMutex, portMAX_DELAY);
    pumpControl.command(command, std::string(flowCounterEpoch.c_str()), millis());
    enforcePumpFailSafe();
    xSemaphoreGive(controlMutex);
    return true;
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

// One AJ-SR04M ping. Blocks for at most ~kLevelEchoTimeoutUs (50 ms) when no echo arrives.
uint32_t pingLevelDistanceMm() {
  const uint32_t startedUs = micros();
  digitalWrite(kLevelTriggerPin, LOW);
  delayMicroseconds(2);
  digitalWrite(kLevelTriggerPin, HIGH);
  delayMicroseconds(kLevelTriggerPulseUs);
  digitalWrite(kLevelTriggerPin, LOW);
  const uint32_t distanceMm = distanceMmFromEchoUs(pulseIn(kLevelEchoPin, HIGH, kLevelEchoTimeoutUs));
  const uint32_t elapsedUs = micros() - startedUs;
  if (elapsedUs > levelWorstPingUs) {
    levelWorstPingUs = elapsedUs;
  }
  return distanceMm;
}

// One ping per cycle, >=70 ms apart; complete a new 5-ping burst every ~400 ms.
// Independent of report cadence and blocking HTTP/OTA; no cached sample is counted.
void updateLevel(unsigned long now) {
  if (!levelBurst.active && static_cast<int32_t>(uint32_t(now-nextLevelBurstAt)) >= 0) {
    levelBurstStart(levelBurst);
    nextLevelBurstAt = now + 400;
  }
  if (!levelBurstPingDue(levelBurst, now)) return;
  const uint32_t distance = pingLevelDistanceMm();
  const uint32_t completedAt = millis();
  levelBurstRecord(levelBurst, completedAt, distance);
  if (levelBurstComplete(levelBurst)) {
    xSemaphoreTake(controlMutex, portMAX_DELAY);
    levelDistanceMm = levelBurstResultMm(levelBurst);
    for (size_t index = 0; index < kLevelSamplesPerBurst; ++index) levelRawMm[index] = levelBurst.samples[index];
    pumpControl.sample(completedAt, levelDistanceMm);
    enforcePumpFailSafe();
    xSemaphoreGive(controlMutex);
    levelBurst.active = false;
  }
}

void updateTemperature() {
  const uint32_t now = millis();
  xSemaphoreTake(controlMutex, portMAX_DELAY);
  temperatureAlarm.tick(now);
  xSemaphoreGive(controlMutex);
  if (uint32_t(now-lastTemperatureReadMs) < kTemperatureSampleIntervalMs) return;
  const uint16_t a = diagnosticHardwareSpi ? readHardwareDiagnostic(diagnosticSpiOne,kThermocoupleOnePins) : readMax6675Frame(kThermocoupleOnePins);
  const uint16_t b = diagnosticHardwareSpi ? readHardwareDiagnostic(diagnosticSpiTwo,kThermocoupleTwoPins) : readMax6675Frame(kThermocoupleTwoPins);
  lastTemperatureReadMs = millis(); // conversion starts on CS rising, never schedule from before the read
  const auto one=decodeMax6675Frame(a), two=decodeMax6675Frame(b);
  xSemaphoreTake(controlMutex, portMAX_DELAY);
  temperature.rawOne=a; temperature.rawTwo=b;
  temperature.sampledAt=lastTemperatureReadMs; temperature.acquired=true;
  temperature.rawOneC=one.status==kMax6675StatusOk ? one.celsius : NAN;
  temperature.rawTwoC=two.status==kMax6675StatusOk ? two.celsius : NAN;
  temperature.oneC=applyTemperatureCalibration(temperature.rawOneC,calibration.sensorOne);
  temperature.twoC=applyTemperatureCalibration(temperature.rawTwoC,calibration.sensorTwo);
  temperature.calibrationRevision=calibration.revision;
  temperatureAlarm.sample(lastTemperatureReadMs,temperature.oneC,temperature.twoC);
  xSemaphoreGive(controlMutex);
  if(serialDiagnostics) printTemperatureDiagnostics(a,b);
}

void controlCycle() {
  xSemaphoreTake(controlMutex, portMAX_DELAY);
  enforcePumpFailSafe();
  xSemaphoreGive(controlMutex);
  updateTemperature();
  updateLevel(millis());
}

void controlTask(void *) {
  for (;;) { controlCycle(); vTaskDelay(pdMS_TO_TICKS(5)); }
}

double calibratedFlowTotalLiters() {
  portENTER_CRITICAL(&flowMux);
  const uint64_t pulses = flowFilter.rawTotalPulses;
  portEXIT_CRITICAL(&flowMux);
  return rawFlowLiters(pulses);
}

void addRawFlowCountersToPayload() {
  portENTER_CRITICAL(&flowMux);
  const uint64_t rawPulses = flowFilter.rawTotalPulses;
  portEXIT_CRITICAL(&flowMux);
  pendingPayload = withRawFlowCounters(std::string(pendingPayload.c_str()), rawPulses,
    std::string(flowCounterEpoch.c_str()), kCalibratedFlowPulsesPerLiter).c_str();
}

void reportTemperature() {
  // Snapshot shared control/level data; never hold the mutex during network I/O.
  xSemaphoreTake(controlMutex, portMAX_DELAY);
  const uint32_t snapshotDistanceMm = levelDistanceMm;
  uint32_t snapshotRawMm[kLevelSamplesPerBurst];
  for (size_t i=0;i<kLevelSamplesPerBurst;++i) snapshotRawMm[i]=levelRawMm[i];
  const bool snapshotPump1=pump1On, snapshotPump2=pump2On;
  const bool automatic=pumpControl.fill.enabled;
  const std::string commandSession=pumpControl.session;
  const uint32_t commandRevision=pumpControl.revision;
  temperatureAlarm.tick(millis());
  const TemperatureSnapshot snapshotTemperature = temperature;
  const TemperatureAlarm snapshotAlarm = temperatureAlarm;
  xSemaphoreGive(controlMutex);
  const uint16_t rawOne = snapshotTemperature.rawOne;
  const uint16_t rawTwo = snapshotTemperature.rawTwo;
  const Max6675Reading sensorOne = decodeMax6675Frame(rawOne);
  const Max6675Reading sensorTwo = decodeMax6675Frame(rawTwo);
  const uint8_t sensorOneStatus = sensorOne.status;
  const uint8_t sensorTwoStatus = sensorTwo.status;
  const String diagnostics = String(",\"diagnostics\":{\"max6675Status\":[") + sensorOneStatus + "," +
                             sensorTwoStatus + "],\"max6675Raw\":[" + rawOne + "," + rawTwo + "],\"levelRawMm\":[" +
                             snapshotRawMm[0] + "," + snapshotRawMm[1] + "," + snapshotRawMm[2] + "," + snapshotRawMm[3] + "," +
                             snapshotRawMm[4] + "]}";
  if (sensorOneStatus != 0 || sensorTwoStatus != 0) {
    Serial.printf("MAX6675 sensor error (status %u, %u, raw 0x%04X, 0x%04X); only failed channels unavailable.\n",
                  sensorOneStatus, sensorTwoStatus, rawOne, rawTwo);

  }
  // Never substitute a numeric sentinel or a previous/other channel's value.
  // NAN is internal only: the JSON contract serializes it as explicit null.
  const bool temperatureFresh = snapshotTemperature.acquired && uint32_t(millis()-snapshotTemperature.sampledAt)<=kTemperatureStaleMs;
  const float thermocoupleOneC = temperatureFresh ? snapshotTemperature.rawOneC : NAN;
  const float thermocoupleTwoC = temperatureFresh ? snapshotTemperature.rawTwoC : NAN;
  const bool levelAvailable = isValidLevelDistanceMm(snapshotDistanceMm);
  if (!levelAvailable) {
    Serial.println("AJ-SR04M unavailable; publishing telemetry without level.");
  }
  pendingPayload = buildFullTelemetryPayload(std::string(config.deviceId.c_str()),
                                             temperatureFresh ? snapshotTemperature.oneC : NAN,
                                             temperatureFresh ? snapshotTemperature.twoC : NAN,
                                             levelAvailable ? snapshotDistanceMm : 0, flowLpm,
                                             calibratedFlowTotalLiters(), snapshotPump1,
                                             snapshotPump2, thermocoupleOneC, thermocoupleTwoC,
                                             snapshotTemperature.calibrationRevision).c_str();
  pendingPayload.remove(pendingPayload.length() - 1);
  pendingPayload += diagnostics + "}";
  addRawFlowCountersToPayload();
  JsonDocument payloadDocument;
  deserializeJson(payloadDocument, pendingPayload);
  payloadDocument["firmwareVersion"] = THERMOMOLD_FIRMWARE_VERSION;
  payloadDocument["temperatureAlarm"]["state"] = snapshotAlarm.state;
  if (std::isfinite(snapshotAlarm.deltaC)) payloadDocument["temperatureAlarm"]["deltaC"] = snapshotAlarm.deltaC;
  else payloadDocument["temperatureAlarm"]["deltaC"] = nullptr;
  payloadDocument["control"]["deviceSession"] = flowCounterEpoch;
  payloadDocument["control"]["mode"] = automatic ? "automatic" : "manual";
  payloadDocument["control"]["session"] = commandSession;
  payloadDocument["control"]["revision"] = commandRevision;
  pendingPayload = "";
  serializeJson(payloadDocument, pendingPayload);
  if (postPayload(pendingPayload)) {
    Serial.printf("Telemetry posted: %.2f C, %.2f C, %s, %.2f L/min\n", thermocoupleOneC,
                  thermocoupleTwoC, levelAvailable ? (String(snapshotDistanceMm) + " mm").c_str() : "level unavailable",
                  flowLpm);
    pendingPayload = "";
    retryDelayMs = kInitialRetryDelayMs;
  } else {
    scheduleRetry();
  }
}
}  // namespace

void setup() {
  configurePumpsOff();
  Serial.begin(115200);
  initializeCalibration();
  // Format a blank/corrupted LittleFS partition so portal settings persist after reset.
  if (!LittleFS.begin(true)) Serial.println("LittleFS unavailable; settings will not persist.");
  loadConfig();
  Serial.printf("ThermoMold firmware=%s. Send d within 2 s for LOCAL diagnostics (no network, relays OFF).\n", THERMOMOLD_FIRMWARE_VERSION);
  const uint32_t start = millis();
  while (millis()-start < 2000) {
    if (Serial.available()) {
      const char command = Serial.read();
      if (command == 'd') { localDiagnosticsOnly = serialDiagnostics = true; break; }
      if (command == 'p') { forceConfigPortal = true; break; }
    }
    delay(5);
  }
  if (!localDiagnosticsOnly) {
    provisionWiFiAndSettings();
    configureOtaClock();
  }
  configureSensor();
  controlMutex = xSemaphoreCreateMutex();
  if (!controlMutex) { configurePumpsOff(); ESP.restart(); }
  // A separate task keeps level decisions/watchdogs alive during blocking TLS/HTTP.
  if (!localDiagnosticsOnly && xTaskCreatePinnedToCore(controlTask, "tank-control", 4096,
      nullptr, 2, nullptr, 1) != pdPASS) { configurePumpsOff(); ESP.restart(); }
  nextReportAt = millis();
  nextOtaCheckAt = millis();
}

void loop() {
  if (Serial.available()) {
    const char c = Serial.read();
    if (c == 'd') serialDiagnostics = true;
    if (c == 'q') serialDiagnostics = false;
    // Local USB calibration uses the same validated command path as the backend.
    // Allowed only in local mode: relays stay OFF, no network command can race it.
    if (c == 'c' && localDiagnosticsOnly) {
      const uint32_t before = calibration.revision;
      Serial.setTimeout(1500);
      const String body = Serial.readStringUntil('\n');
      applyCalibrationCommand(body);
      Serial.printf("LOCAL_CALIBRATION previous=%lu revision=%lu changed=%u\n",
        (unsigned long)before, (unsigned long)calibration.revision, before != calibration.revision);
    }
    if (c == 'h' && localDiagnosticsOnly) {
      diagnosticHardwareSpi = !diagnosticHardwareSpi;
      if (diagnosticHardwareSpi) {
        diagnosticSpiOne.begin(kThermocoupleOneSckPin,kThermocoupleOneSoPin,-1,-1);
        diagnosticSpiTwo.begin(kThermocoupleTwoSckPin,kThermocoupleTwoSoPin,-1,-1);
      } else {
        diagnosticSpiOne.end(); diagnosticSpiTwo.end();
        configureMax6675Pins(kThermocoupleOnePins);
        configureMax6675Pins(kThermocoupleTwoPins);
      }
      lastTemperatureReadMs = millis();
    }
  }
  if (localDiagnosticsOnly) {
    updateFlow();
    updateTemperature();
    delay(1);
    return;
  }
  ensureWiFi();
  updateFlow();
  // Signed modular deadline comparisons tolerate millis() rollover (provided
  // deadlines are less than 2^31 ms away). Refresh after blocking operations.
  if (static_cast<int32_t>(static_cast<uint32_t>(millis() - nextOtaCheckAt)) >= 0) {
    checkForOtaUpdate();
    // NTP synchronization starts asynchronously. Retry soon until TLS has a valid clock;
    // once valid, retain the normal 15-minute polling interval.
    nextOtaCheckAt = millis() + (hasValidOtaTime() ? kOtaCheckIntervalMs : 30000UL);
  }
  if (!pendingPayload.isEmpty() &&
      static_cast<int32_t>(static_cast<uint32_t>(millis() - nextRetryAt)) >= 0) {
    // Rebuild from the local snapshot: never replay an old alarm as a fresh sample.
    reportTemperature();
    nextReportAt = millis() + minimumTelemetryIntervalMs();
  }
  if (pendingPayload.isEmpty() &&
      static_cast<int32_t>(static_cast<uint32_t>(millis() - nextReportAt)) >= 0) {
    reportTemperature();
    // POST may block; acquisition continues independently in the control task.
    nextReportAt = millis() + minimumTelemetryIntervalMs();
  }
}
