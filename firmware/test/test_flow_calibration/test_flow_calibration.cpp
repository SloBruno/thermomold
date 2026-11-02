#include <unity.h>
#include <cmath>
#include "flow_calibration.h"
void setUp(){}
void tearDown(){}
void test_coefficient_averages_all_three_500ml_runs(){
 TEST_ASSERT_TRUE(std::fabs(51270.666666666664-kCalibratedFlowPulsesPerLiter)<0.001);
 double total=rawFlowLiters(27988)+rawFlowLiters(24496)+rawFlowLiters(24422);
 TEST_ASSERT_TRUE(std::fabs(1.5-total)<0.000001);
}
void test_raw_rate_and_volume_use_same_coefficient(){
 TEST_ASSERT_TRUE(std::fabs(rawFlowLiters(1000)*60-rawFlowLpm(1000,1000))<0.000001);
 TEST_ASSERT_EQUAL(0,rawFlowLpm(1000,0));
 TEST_ASSERT_EQUAL(0,rawFlowLpm(0,1000));
 TEST_ASSERT_EQUAL(0,rawFlowLiters(0));
}
int main(){UNITY_BEGIN();RUN_TEST(test_coefficient_averages_all_three_500ml_runs);RUN_TEST(test_raw_rate_and_volume_use_same_coefficient);return UNITY_END();}
