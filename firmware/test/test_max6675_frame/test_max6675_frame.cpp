#include <unity.h>

#include "max6675_frame.h"

void setUp() {}
void tearDown() {}

// Real frames captured by tools/max6675_diag (variant C, hand bit-bang) at room temperature.
void test_room_temperature_frame_decodes_to_celsius() {
  const Max6675Reading reading = decodeMax6675Frame(0x0308);  // 97 counts
  TEST_ASSERT_EQUAL_UINT8(kMax6675StatusOk, reading.status);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 24.25f, reading.celsius);
}

void test_ignores_three_state_bit() {
  const Max6675Reading reading = decodeMax6675Frame(0x0309);
  TEST_ASSERT_EQUAL_UINT8(kMax6675StatusOk, reading.status);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 24.25f, reading.celsius);
}

void test_full_scale_frame() {
  const Max6675Reading reading = decodeMax6675Frame(0x7FF8);  // 4095 counts
  TEST_ASSERT_EQUAL_UINT8(kMax6675StatusOk, reading.status);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1023.75f, reading.celsius);
}

void test_open_thermocouple_bit() {
  TEST_ASSERT_EQUAL_UINT8(kMax6675StatusOpen, decodeMax6675Frame(0x0304).status);
}

void test_floating_so_line_is_no_communication() {
  TEST_ASSERT_EQUAL_UINT8(kMax6675StatusNoCommunication, decodeMax6675Frame(0xFFFF).status);
}

void test_dummy_sign_bit_set_is_corrupted_transfer() {
  TEST_ASSERT_EQUAL_UINT8(kMax6675StatusNoCommunication, decodeMax6675Frame(0x8308).status);
}

void test_device_id_bit_set_is_corrupted_transfer() {
  TEST_ASSERT_EQUAL_UINT8(kMax6675StatusNoCommunication, decodeMax6675Frame(0x030A).status);
}

void test_status_codes_match_dashboard_contract() {
  TEST_ASSERT_EQUAL_UINT8(0x04, kMax6675StatusOpen);
  TEST_ASSERT_EQUAL_UINT8(0x80, kMax6675StatusNoRead);
  TEST_ASSERT_EQUAL_UINT8(0x81, kMax6675StatusNoCommunication);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_room_temperature_frame_decodes_to_celsius);
  RUN_TEST(test_ignores_three_state_bit);
  RUN_TEST(test_full_scale_frame);
  RUN_TEST(test_open_thermocouple_bit);
  RUN_TEST(test_floating_so_line_is_no_communication);
  RUN_TEST(test_dummy_sign_bit_set_is_corrupted_transfer);
  RUN_TEST(test_device_id_bit_set_is_corrupted_transfer);
  RUN_TEST(test_status_codes_match_dashboard_contract);
  return UNITY_END();
}
