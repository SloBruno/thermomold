#include <unity.h>
#include <cstring>
#include <string>

#include "sensor_readings.h"
#include "telemetry_contract.h"
#include "actuators.h"
#include "ota_update.h"

void test_payload_contains_the_required_exact_contract_fields() {
  const std::string payload = buildTelemetryPayload("press-01", 123.45);

  TEST_ASSERT_EQUAL_STRING(
      "{\"deviceId\":\"press-01\",\"temperatureC\":123.45,\"sensor\":\"MAX6675\"}",
      payload.c_str());
}

void test_json_string_escapes_device_id() {
  const std::string payload = buildTelemetryPayload("press-\"01", 10.0);

  TEST_ASSERT_EQUAL_STRING(
      "{\"deviceId\":\"press-\\\"01\",\"temperatureC\":10,\"sensor\":\"MAX6675\"}",
      payload.c_str());
}

void test_multi_sensor_payload_preserves_legacy_temperature_and_includes_both_thermocouples_and_level() {
  const std::string payload = buildMultiSensorTelemetryPayload("press-01", 123.45, 126.5, 350);

  TEST_ASSERT_EQUAL_STRING(
      "{\"deviceId\":\"press-01\",\"temperatureC\":123.45,\"sensor\":\"MAX6675\",\"sensors\":{\"thermocouples\":[{\"id\":\"max6675-1\",\"temperatureC\":123.45},{\"id\":\"max6675-2\",\"temperatureC\":126.5}],\"level\":{\"sensor\":\"AJ-SR04M\",\"distanceMm\":350}}}",
      payload.c_str());
}

void test_ultrasonic_echo_conversion_rejects_timeouts() {
  TEST_ASSERT_EQUAL_UINT32(350, distanceMmFromEchoUs(2041));
  TEST_ASSERT_FALSE(isValidLevelDistanceMm(distanceMmFromEchoUs(0)));
}

void test_secure_endpoint_detection_accepts_only_https_scheme() {
  TEST_ASSERT_TRUE(hasHttpsScheme("https://thermomold.onrender.com/api/telemetry"));
  TEST_ASSERT_FALSE(hasHttpsScheme("http://thermomold.onrender.com/api/telemetry"));
  TEST_ASSERT_FALSE(hasHttpsScheme("HTTPS://thermomold.onrender.com/api/telemetry"));
}

void test_default_endpoint_targets_the_public_thermomold_backend() {
  TEST_ASSERT_EQUAL_STRING("https://thermomold.onrender.com/api/telemetry",
                           defaultTelemetryEndpoint().c_str());
}

void test_minimum_telemetry_interval_is_half_a_second() {
  TEST_ASSERT_EQUAL_UINT32(500, minimumTelemetryIntervalMs());
}

void test_flow_converts_pulses_in_a_window_to_liters_per_minute() {
  // ZJ-S201: 7.5 pulses per second per L/min.
  TEST_ASSERT_EQUAL_FLOAT(2.0f, flowLitersPerMinute(15, 1000));
  TEST_ASSERT_EQUAL_FLOAT(2.0f, flowLitersPerMinute(7, 467) > 1.99f ? 2.0f : 0.0f);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, flowLitersPerMinute(10, 0));
}

void test_flow_pulses_accumulate_to_liters() {
  // 450 pulses per liter (7.5 pulses/s per L/min * 60 s).
  TEST_ASSERT_EQUAL_FLOAT(1.0f, litersFromPulses(450));
}

void test_pump_command_expires_after_timeout_including_millis_rollover() {
  TEST_ASSERT_FALSE(pumpCommandExpired(1000, 3999, 3000));
  TEST_ASSERT_TRUE(pumpCommandExpired(1000, 4001, 3000));
  TEST_ASSERT_FALSE(pumpCommandExpired(0xFFFFFF00UL, 0x00000100UL, 3000));
}

void test_parse_pump_command_reads_both_pumps_from_response() {
  PumpCommand command = parsePumpCommand(
      "{\"accepted\":true,\"commands\":{\"pumps\":{\"pump1\":true,\"pump2\":false}}}");
  TEST_ASSERT_TRUE(command.valid);
  TEST_ASSERT_TRUE(command.pump1);
  TEST_ASSERT_FALSE(command.pump2);
}

void test_parse_pump_command_fails_safe_when_missing_or_garbled() {
  PumpCommand missing = parsePumpCommand("{\"accepted\":true}");
  TEST_ASSERT_FALSE(missing.valid);
  TEST_ASSERT_FALSE(missing.pump1);
  TEST_ASSERT_FALSE(missing.pump2);

  PumpCommand partial = parsePumpCommand("{\"commands\":{\"pumps\":{\"pump1\":true}}}");
  TEST_ASSERT_FALSE(partial.valid);
  TEST_ASSERT_FALSE(partial.pump1);
}

void test_ota_manifest_accepts_only_a_newer_https_version_with_sha256() {
  const OtaManifest manifest = parseOtaManifest(
      "{\"version\":\"1.2.0\",\"url\":\"https://thermomold.onrender.com/ota/thermomold.bin\","
      "\"sha256\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}");
  TEST_ASSERT_TRUE(manifest.valid);
  TEST_ASSERT_TRUE(isNewerFirmwareVersion("1.1.9", manifest.version));
  TEST_ASSERT_FALSE(isNewerFirmwareVersion("1.2.0", manifest.version));
  TEST_ASSERT_FALSE(isNewerFirmwareVersion("1.3.0", manifest.version));
}

void test_ota_manifest_rejects_http_and_invalid_hashes() {
  const OtaManifest insecure = parseOtaManifest(
      "{\"version\":\"1.2.0\",\"url\":\"http://example.com/firmware.bin\",\"sha256\":\"bad\"}");
  TEST_ASSERT_FALSE(insecure.valid);
}

void test_ota_manifest_rejects_uppercase_hash_and_non_newer_version() {
  const OtaManifest uppercaseHash = parseOtaManifest(
      "{\"version\":\"0.1.0\",\"url\":\"https://thermomold.onrender.com/ota/thermomold.bin\","
      "\"sha256\":\"ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789\"}");
  TEST_ASSERT_FALSE(uppercaseHash.valid);
  TEST_ASSERT_FALSE(isNewerFirmwareVersion("0.1.0", "0.1.0"));
}

void test_full_payload_omits_an_unavailable_level_sensor_without_blocking_telemetry() {
  const std::string payload = buildFullTelemetryPayload("press-01", 123.45, 126.5, 0, 0, 0, false, false);
  TEST_ASSERT_NOT_NULL(strstr(payload.c_str(), "\"thermocouples\""));
  TEST_ASSERT_NULL(strstr(payload.c_str(), "\"level\""));
}

void test_full_payload_appends_flow_and_actual_pump_state() {
  const std::string payload = buildFullTelemetryPayload("press-01", 123.45, 126.5, 350, 2.4, 12.75, true, false);

  TEST_ASSERT_EQUAL_STRING(
      "{\"deviceId\":\"press-01\",\"temperatureC\":123.45,\"sensor\":\"MAX6675\",\"sensors\":{\"thermocouples\":[{\"id\":\"max6675-1\",\"temperatureC\":123.45},{\"id\":\"max6675-2\",\"temperatureC\":126.5}],\"level\":{\"sensor\":\"AJ-SR04M\",\"distanceMm\":350},\"flow\":{\"sensor\":\"ZJ-S201\",\"litersPerMinute\":2.4,\"totalLiters\":12.75}},\"pumps\":{\"pump1\":true,\"pump2\":false}}",
      payload.c_str());
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_payload_contains_the_required_exact_contract_fields);
  RUN_TEST(test_json_string_escapes_device_id);
  RUN_TEST(test_multi_sensor_payload_preserves_legacy_temperature_and_includes_both_thermocouples_and_level);
  RUN_TEST(test_ultrasonic_echo_conversion_rejects_timeouts);
  RUN_TEST(test_secure_endpoint_detection_accepts_only_https_scheme);
  RUN_TEST(test_default_endpoint_targets_the_public_thermomold_backend);
  RUN_TEST(test_minimum_telemetry_interval_is_half_a_second);
  RUN_TEST(test_flow_converts_pulses_in_a_window_to_liters_per_minute);
  RUN_TEST(test_flow_pulses_accumulate_to_liters);
  RUN_TEST(test_pump_command_expires_after_timeout_including_millis_rollover);
  RUN_TEST(test_parse_pump_command_reads_both_pumps_from_response);
  RUN_TEST(test_parse_pump_command_fails_safe_when_missing_or_garbled);
  RUN_TEST(test_ota_manifest_accepts_only_a_newer_https_version_with_sha256);
  RUN_TEST(test_ota_manifest_rejects_http_and_invalid_hashes);
  RUN_TEST(test_ota_manifest_rejects_uppercase_hash_and_non_newer_version);
  RUN_TEST(test_full_payload_omits_an_unavailable_level_sensor_without_blocking_telemetry);
  RUN_TEST(test_full_payload_appends_flow_and_actual_pump_state);
  return UNITY_END();
}
