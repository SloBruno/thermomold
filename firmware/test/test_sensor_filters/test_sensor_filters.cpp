#include <unity.h>

#include <cmath>
#include <cstdint>

#include "flow_filter.h"
#include "level_filter.h"

void setUp() {}
void tearDown() {}

namespace {
// Drives the pure ISR filter + window confirmation exactly as main.cpp does:
// edges are fed with micros() timestamps and a window is closed every windowMs.
struct FlowSim {
  FlowPulseFilter filter;
  FlowMeter meter;
  uint64_t nextWindowUs = 1000000ULL;
  uint32_t windowMs = 1000;

  void closeWindowsUpTo(uint64_t timeUs) {
    while (timeUs >= nextWindowUs) {
      flowMeterUpdate(meter, takeFlowWindow(filter, windowMs));
      nextWindowUs += static_cast<uint64_t>(windowMs) * 1000ULL;
    }
  }
  void edge(uint64_t timeUs) {
    closeWindowsUpTo(timeUs);
    flowPulseEdge(filter, static_cast<uint32_t>(timeUs));
  }
};

// Feeds a perfectly regular flow of `lpm` from startUs for durationS seconds, then closes windows.
void runSteadyFlow(FlowSim &sim, float lpm, uint64_t startUs, double durationS) {
  const double periodUs = 1e6 / (kFlowPulsesPerSecondPerLpm * lpm);
  for (double t = static_cast<double>(startUs); t < startUs + durationS * 1e6; t += periodUs) {
    sim.edge(static_cast<uint64_t>(t));
  }
}

void assertFlowPreserved(float lpm) {
  FlowSim sim;
  runSteadyFlow(sim, lpm, 0, 10.0);
  sim.closeWindowsUpTo(10000000ULL);  // close all 10 full windows
  const float expectedLiters = lpm * 10.0f / 60.0f;
  TEST_ASSERT_FLOAT_WITHIN(lpm * 0.05f, lpm, sim.meter.lpm);
  TEST_ASSERT_FLOAT_WITHIN(expectedLiters * 0.05f, expectedLiters,
                           litersFromPulses(sim.meter.totalPulses));
}
}  // namespace

void test_minimum_pulse_interval_is_safely_below_the_30_lpm_period() {
  // 30 L/min * 7.5 Hz = 225 Hz -> 4444 us period; the filter must keep >= 2x margin.
  TEST_ASSERT_EQUAL_UINT32(2000, kFlowMinPulseIntervalUs);
  TEST_ASSERT_TRUE(kFlowMinPulseIntervalUs * 2 <= 1000000.0f / (30.0f * kFlowPulsesPerSecondPerLpm));
}

void test_pulses_closer_than_minimum_interval_are_ignored() {
  FlowPulseFilter filter;
  TEST_ASSERT_TRUE(flowPulseEdge(filter, 10000));
  TEST_ASSERT_FALSE(flowPulseEdge(filter, 10500));   // 0.5 ms: glitch
  TEST_ASSERT_FALSE(flowPulseEdge(filter, 11900));   // 1.4 ms after the glitch
  TEST_ASSERT_TRUE(flowPulseEdge(filter, 14000));    // 2.1 ms after last edge
  TEST_ASSERT_EQUAL_UINT32(2, filter.accepted);
}

void test_pulse_interval_filter_survives_micros_rollover() {
  FlowPulseFilter filter;
  TEST_ASSERT_TRUE(flowPulseEdge(filter, 0xFFFFFF00UL));
  TEST_ASSERT_FALSE(flowPulseEdge(filter, 0x00000100UL));  // 512 us later across rollover
  TEST_ASSERT_TRUE(flowPulseEdge(filter, 0x00001000UL));   // ~4.3 ms later
}

void test_continuous_high_frequency_noise_is_not_counted() {
  FlowPulseFilter filter;
  for (uint32_t t = 0; t < 1000000; t += 1000) flowPulseEdge(filter, t);  // 1 kHz EMI
  TEST_ASSERT_EQUAL_UINT32(1, filter.accepted);
}

void test_short_isolated_burst_does_not_become_flow() {
  FlowSim sim;
  // 20 well-spaced (2.5 ms) pulses in 50 ms, e.g. a relay switching transient.
  for (int index = 0; index < 20; ++index) sim.edge(300000ULL + index * 2500ULL);
  sim.closeWindowsUpTo(5000000ULL);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, sim.meter.lpm);
  TEST_ASSERT_EQUAL_UINT32(0, sim.meter.totalPulses);
}

void test_burst_split_across_window_boundary_does_not_become_flow() {
  FlowSim sim;
  for (int index = 0; index < 40; ++index) sim.edge(950000ULL + index * 2500ULL);
  sim.closeWindowsUpTo(5000000ULL);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, sim.meter.lpm);
  TEST_ASSERT_EQUAL_UINT32(0, sim.meter.totalPulses);
}

void test_single_noisy_window_without_confirmation_is_discarded() {
  FlowSim sim;
  runSteadyFlow(sim, 5.0f, 0, 1.0);  // looks like flow for exactly one window
  sim.closeWindowsUpTo(4000000ULL);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, sim.meter.lpm);
  TEST_ASSERT_EQUAL_UINT32(0, sim.meter.totalPulses);
}

void test_real_flow_of_2_lpm_is_preserved_within_5_percent() { assertFlowPreserved(2.0f); }
void test_real_flow_of_10_lpm_is_preserved_within_5_percent() { assertFlowPreserved(10.0f); }
void test_real_flow_of_30_lpm_is_preserved_within_5_percent() { assertFlowPreserved(30.0f); }

void test_real_flow_with_contact_bounce_is_preserved() {
  FlowSim sim;
  const double periodUs = 1e6 / (kFlowPulsesPerSecondPerLpm * 10.0f);
  for (double t = 0; t < 10e6; t += periodUs) {
    sim.edge(static_cast<uint64_t>(t));
    sim.edge(static_cast<uint64_t>(t) + 40);   // bounce 40 us after each real edge
  }
  sim.closeWindowsUpTo(10000000ULL);
  TEST_ASSERT_FLOAT_WITHIN(0.5f, 10.0f, sim.meter.lpm);
  TEST_ASSERT_FLOAT_WITHIN(10.0f / 6.0f * 0.05f, 10.0f / 6.0f, litersFromPulses(sim.meter.totalPulses));
}

void test_flow_below_minimum_threshold_reads_zero_and_does_not_add_to_total() {
  FlowSim sim;
  runSteadyFlow(sim, 0.6f, 0, 10.0);  // below the 1 L/min sensor minimum
  sim.closeWindowsUpTo(10000000ULL);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, sim.meter.lpm);
  TEST_ASSERT_EQUAL_UINT32(0, sim.meter.totalPulses);
}

void test_flow_stops_reporting_when_pulses_stop() {
  FlowSim sim;
  runSteadyFlow(sim, 10.0f, 0, 5.0);
  sim.closeWindowsUpTo(5000000ULL);
  const uint32_t total = sim.meter.totalPulses;
  TEST_ASSERT_TRUE(sim.meter.lpm > 9.0f);
  sim.closeWindowsUpTo(8000000ULL);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, sim.meter.lpm);
  TEST_ASSERT_EQUAL_UINT32(total, sim.meter.totalPulses);
}

void test_level_trigger_and_burst_timing_follow_datasheet() {
  TEST_ASSERT_EQUAL_UINT32(20, kLevelTriggerPulseUs);
  TEST_ASSERT_EQUAL_UINT32(5, kLevelSamplesPerBurst);
  TEST_ASSERT_TRUE(kLevelPingSpacingMs >= 60);
  // Echo timeout must cover the 8 m maximum range round trip (~46.6 ms).
  TEST_ASSERT_TRUE(kLevelEchoTimeoutUs >= static_cast<uint32_t>(2.0f * kAjSr04mMaxRangeMm / kAjSr04mSoundSpeedMmPerUs));
}

void test_level_validation_rejects_blind_zone_and_out_of_range() {
  TEST_ASSERT_FALSE(isValidLevelDistanceMm(0));
  TEST_ASSERT_FALSE(isValidLevelDistanceMm(199));
  TEST_ASSERT_TRUE(isValidLevelDistanceMm(200));
  TEST_ASSERT_TRUE(isValidLevelDistanceMm(265));
  TEST_ASSERT_TRUE(isValidLevelDistanceMm(8000));
  TEST_ASSERT_FALSE(isValidLevelDistanceMm(8001));
}

void test_level_median_ignores_invalid_and_outlier_samples() {
  const uint32_t samples[5] = {0, 990, 265, 263, 267};
  TEST_ASSERT_EQUAL_UINT32(267, medianValidLevelMm(samples, 5));  // valid: 263,265,267,990
  const uint32_t noisy[5] = {325, 264, 990, 266, 265};
  TEST_ASSERT_EQUAL_UINT32(266, medianValidLevelMm(noisy, 5));  // 264,265,266,325,990
}

void test_level_median_reports_unavailable_with_fewer_than_three_valid() {
  const uint32_t samples[5] = {0, 150, 265, 9000, 266};
  TEST_ASSERT_EQUAL_UINT32(0, medianValidLevelMm(samples, 5));
  const uint32_t three[5] = {0, 150, 265, 270, 266};
  TEST_ASSERT_EQUAL_UINT32(266, medianValidLevelMm(three, 5));
}

void test_level_burst_spaces_pings_and_completes_after_five() {
  LevelBurst burst;
  levelBurstStart(burst);
  TEST_ASSERT_TRUE(levelBurstPingDue(burst, 1000));
  levelBurstRecord(burst, 1000, 265);
  TEST_ASSERT_FALSE(levelBurstPingDue(burst, 1069));
  TEST_ASSERT_TRUE(levelBurstPingDue(burst, 1070));
  uint32_t now = 1070;
  const uint32_t values[4] = {0, 266, 990, 264};
  for (uint32_t value : values) {
    TEST_ASSERT_TRUE(levelBurstPingDue(burst, now));
    levelBurstRecord(burst, now, value);
    now += kLevelPingSpacingMs;
  }
  TEST_ASSERT_TRUE(levelBurstComplete(burst));
  TEST_ASSERT_FALSE(levelBurstPingDue(burst, now + 1000));
  TEST_ASSERT_EQUAL_UINT32(266, levelBurstResultMm(burst));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_minimum_pulse_interval_is_safely_below_the_30_lpm_period);
  RUN_TEST(test_pulses_closer_than_minimum_interval_are_ignored);
  RUN_TEST(test_pulse_interval_filter_survives_micros_rollover);
  RUN_TEST(test_continuous_high_frequency_noise_is_not_counted);
  RUN_TEST(test_short_isolated_burst_does_not_become_flow);
  RUN_TEST(test_burst_split_across_window_boundary_does_not_become_flow);
  RUN_TEST(test_single_noisy_window_without_confirmation_is_discarded);
  RUN_TEST(test_real_flow_of_2_lpm_is_preserved_within_5_percent);
  RUN_TEST(test_real_flow_of_10_lpm_is_preserved_within_5_percent);
  RUN_TEST(test_real_flow_of_30_lpm_is_preserved_within_5_percent);
  RUN_TEST(test_real_flow_with_contact_bounce_is_preserved);
  RUN_TEST(test_flow_below_minimum_threshold_reads_zero_and_does_not_add_to_total);
  RUN_TEST(test_flow_stops_reporting_when_pulses_stop);
  RUN_TEST(test_level_trigger_and_burst_timing_follow_datasheet);
  RUN_TEST(test_level_validation_rejects_blind_zone_and_out_of_range);
  RUN_TEST(test_level_median_ignores_invalid_and_outlier_samples);
  RUN_TEST(test_level_median_reports_unavailable_with_fewer_than_three_valid);
  RUN_TEST(test_level_burst_spaces_pings_and_completes_after_five);
  return UNITY_END();
}
