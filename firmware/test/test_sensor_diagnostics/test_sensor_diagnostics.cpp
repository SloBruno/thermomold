#include <unity.h>
#include "flow_filter.h"
void setUp() {}
void tearDown() {}
void test_raw_edges_survive_window_reset() {
 FlowPulseFilter f;
 flowPulseEdge(f,10000); flowPulseEdge(f,10500); flowPulseEdge(f,14000);
 TEST_ASSERT_EQUAL_UINT32(3,f.rawEdges);
 auto w=takeFlowWindow(f,1000);
 TEST_ASSERT_EQUAL_UINT32(2,w.pulses);
 TEST_ASSERT_EQUAL_UINT32(3,w.rawEdges);
 TEST_ASSERT_EQUAL_UINT32(0,f.rawEdges);
}
int main(){ UNITY_BEGIN(); RUN_TEST(test_raw_edges_survive_window_reset); return UNITY_END(); }
