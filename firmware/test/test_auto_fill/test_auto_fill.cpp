#include <unity.h>
#include "auto_fill.h"
void stable_low_level() {
  AutoFill control;
  control.enable();
  control.sample(0, 303);
  TEST_ASSERT_FALSE(control.pump1);
  for (uint32_t t=400;t<=1600;t+=400) control.sample(t,303);
  TEST_ASSERT_FALSE(control.pump1);
  control.sample(2000,303); // exactly 75%: both pumps
  TEST_ASSERT_TRUE(control.pump1);
  TEST_ASSERT_TRUE(control.pump2);
}
void thresholds_noise_and_recovery() {
  AutoFill c; TEST_ASSERT_FALSE(c.enabled); TEST_ASSERT_FALSE(c.pump1);
  c.enable();
  for(uint32_t t=0;t<=2000;t+=400)c.sample(t,303);
  TEST_ASSERT_TRUE(c.pump2);
  for(uint32_t t=2400;t<=4000;t+=400)c.sample(t,302); // <2s, retain both
  TEST_ASSERT_TRUE(c.pump2);
  c.sample(4400,303); c.sample(4800,302);
  for(uint32_t t=5200;t<6800;t+=400)c.sample(t,302);
  TEST_ASSERT_TRUE(c.pump2); c.sample(6800,302);
  TEST_ASSERT_TRUE(c.pump1); TEST_ASSERT_FALSE(c.pump2);
  for(uint32_t t=7200;t<=9200;t+=400)c.sample(t,295); // exactly95%
  TEST_ASSERT_FALSE(c.pump1);
  for(uint32_t t=9600;t<=11600;t+=400)c.sample(t,296); // >75 and <95
  TEST_ASSERT_TRUE(c.pump1); TEST_ASSERT_FALSE(c.pump2);
  c.sample(12000,0); c.sample(12400,199); c.tick(13600);
  TEST_ASSERT_TRUE(c.pump1); c.tick(13601); TEST_ASSERT_FALSE(c.pump1);
  for(uint32_t t=14000;t<16000;t+=400)c.sample(t,333);
  TEST_ASSERT_FALSE(c.pump1); c.sample(16000,333); TEST_ASSERT_TRUE(c.pump2);
  c.stop(); c.sample(16400,333); TEST_ASSERT_FALSE(c.pump1);
  c.enable(); c.sample(16800,333); TEST_ASSERT_FALSE(c.pump1);
}
void no_cached_measurement_or_missing_burst_counts_as_persistence() {
 AutoFill c; c.enable(); c.sample(0,303);
 for(uint32_t t=1;t<=2000;t++)c.tick(t);
 TEST_ASSERT_FALSE(c.pump1);
 c.sample(2000,303); TEST_ASSERT_FALSE(c.pump1); // no continuous evidence
 for(uint32_t t=2400;t<=4000;t+=400)c.sample(t,303);
 TEST_ASSERT_TRUE(c.pump1);
}
void rollover_and_invalid_interrupt_pending() {
 AutoFill c;c.enable(); const uint32_t start=0xffffff00u;
 for(uint32_t dt=0;dt<=2000;dt+=400)c.sample(start+dt,303);
 TEST_ASSERT_TRUE(c.pump2); c.tick(start+4001); TEST_ASSERT_FALSE(c.pump1);
 c.sample(start+4400,303);c.sample(start+4800,0);
 for(uint32_t dt=5200;dt<7200;dt+=400)c.sample(start+dt,303);
 TEST_ASSERT_FALSE(c.pump1); c.sample(start+7200,303);TEST_ASSERT_TRUE(c.pump1);
}
int main() { UNITY_BEGIN(); RUN_TEST(stable_low_level); RUN_TEST(thresholds_noise_and_recovery); RUN_TEST(no_cached_measurement_or_missing_burst_counts_as_persistence); RUN_TEST(rollover_and_invalid_interrupt_pending); return UNITY_END(); }
