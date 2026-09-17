#include <unity.h>
#include <string>

#include "sensor_readings.h"
#include "telemetry_contract.h"

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

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_payload_contains_the_required_exact_contract_fields);
  RUN_TEST(test_json_string_escapes_device_id);
  RUN_TEST(test_multi_sensor_payload_preserves_legacy_temperature_and_includes_both_thermocouples_and_level);
  RUN_TEST(test_ultrasonic_echo_conversion_rejects_timeouts);
  RUN_TEST(test_secure_endpoint_detection_accepts_only_https_scheme);
  RUN_TEST(test_default_endpoint_targets_the_public_thermomold_backend);
  RUN_TEST(test_minimum_telemetry_interval_is_half_a_second);
  return UNITY_END();
}
