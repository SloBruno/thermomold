#include <unity.h>
#include <string>

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

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_payload_contains_the_required_exact_contract_fields);
  RUN_TEST(test_json_string_escapes_device_id);
  return UNITY_END();
}
