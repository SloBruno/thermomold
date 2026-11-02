#include <unity.h>
#include "calibration.h"
void setUp(){}
void tearDown(){}
void test_measured_two_point_fit(){
 const SensorCalibration one={{0.0f,0.0f},{10.3625f,24.4f}};
 const SensorCalibration two={{17.26271186440678f,0.0f},{40.29375f,24.4f}};
 TEST_ASSERT_FLOAT_WITHIN(0.001f,0.0f,applyTemperatureCalibration(0,one));
 TEST_ASSERT_FLOAT_WITHIN(0.001f,24.4f,applyTemperatureCalibration(10.3625f,one));
 TEST_ASSERT_FLOAT_WITHIN(0.001f,0.0f,applyTemperatureCalibration(17.26271186440678f,two));
 TEST_ASSERT_FLOAT_WITHIN(0.001f,24.4f,applyTemperatureCalibration(40.29375f,two));
}
int main(){UNITY_BEGIN();RUN_TEST(test_measured_two_point_fit);return UNITY_END();}
