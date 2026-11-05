#include <unity.h>
#include "temperature_alarm.h"
void boundaries_and_persistence() {
 TemperatureAlarm a;
 a.sample(0,20,23); TEST_ASSERT_EQUAL_STRING("normal",a.state);
 a.sample(250,20,25); TEST_ASSERT_EQUAL_STRING("pending",a.state);
 for(uint32_t t=500;t<2250;t+=250)a.sample(t,20,25);
 TEST_ASSERT_EQUAL_STRING("pending",a.state);
 a.sample(2250,20,25); TEST_ASSERT_EQUAL_STRING("warning",a.state);
 a.sample(2500,23,20); TEST_ASSERT_EQUAL_STRING("normal",a.state);
 a.sample(2750,20,25.01); TEST_ASSERT_EQUAL_STRING("severe",a.state);
 a.sample(3000,20,24); TEST_ASSERT_EQUAL_STRING("pending",a.state);
 for(uint32_t t=3250;t<=4750;t+=250)a.sample(t,20,24);
 TEST_ASSERT_EQUAL_STRING("warning",a.state);
 a.sample(5000,20,26);a.sample(5250,20,24);TEST_ASSERT_EQUAL_STRING("warning",a.state);
}
void invalid_gaps_cached_and_rollover() {
 TemperatureAlarm a; a.sample(0,20,24);
 for(uint32_t t=1;t<=2000;t++)a.tick(t);
 TEST_ASSERT_EQUAL_STRING("unknown",a.state);
 a.sample(2000,20,24);TEST_ASSERT_EQUAL_STRING("pending",a.state);
 a.sample(2250,NAN,24);TEST_ASSERT_EQUAL_STRING("unknown",a.state);
 a.sample(2500,20,24);a.sample(3251,20,24);TEST_ASSERT_EQUAL_STRING("pending",a.state);
 a.sample(3500,20,INFINITY);TEST_ASSERT_EQUAL_STRING("unknown",a.state);
 const uint32_t start=0xffffff00u;
 for(uint32_t dt=0;dt<=2000;dt+=250)a.sample(start+dt,25,21);
 TEST_ASSERT_EQUAL_STRING("warning",a.state);
 a.tick(start+2751);TEST_ASSERT_EQUAL_STRING("unknown",a.state);
 a.sample(start+3000,30,20);TEST_ASSERT_EQUAL_STRING("severe",a.state);
}
int main(){UNITY_BEGIN();RUN_TEST(boundaries_and_persistence);RUN_TEST(invalid_gaps_cached_and_rollover);return UNITY_END();}
