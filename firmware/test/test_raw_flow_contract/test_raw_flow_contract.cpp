#include <unity.h>
#include "flow_filter.h"
#include "telemetry_contract.h"
void setUp(){}
void tearDown(){}
void test_lifetime_raw_pulses_include_rejected_and_survive_windows(){
 FlowPulseFilter f;
 flowPulseEdge(f,10000);flowPulseEdge(f,10500);flowPulseEdge(f,14000);
 takeFlowWindow(f,1000);
 TEST_ASSERT_EQUAL_UINT32(3,f.rawTotalPulses);
 flowPulseEdge(f,15000);
 TEST_ASSERT_EQUAL_UINT32(4,f.rawTotalPulses);
}
void test_raw_contract_is_injected_into_flow_only(){
 const auto s=withRawFlowCounters("{\"sensors\":{\"flow\":{\"sensor\":\"ZJ-S201\",\"litersPerMinute\":0,\"totalLiters\":0}}}",42,"boot-a",450);
 TEST_ASSERT_NOT_EQUAL(std::string::npos,s.find("\"rawTotalPulses\":42"));
 TEST_ASSERT_NOT_EQUAL(std::string::npos,s.find("\"counterEpoch\":\"boot-a\""));
 TEST_ASSERT_NOT_EQUAL(std::string::npos,s.find("\"pulsesPerLiter\":450,"));
}
int main(){UNITY_BEGIN();RUN_TEST(test_lifetime_raw_pulses_include_rejected_and_survive_windows);RUN_TEST(test_raw_contract_is_injected_into_flow_only);return UNITY_END();}
