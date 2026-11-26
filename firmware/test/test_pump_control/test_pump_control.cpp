#include <unity.h>
#include "actuators.h"
#include "pump_control.h"
void protocol_scope_and_types() {
  auto c=parsePumpCommand(R"({ "sample":{"pumps":{"pump1":true,"pump2":true}}, "commands": { "pumps": { "pump1":false,"pump2":false,"mode":"automatic","session":"server1","revision":2,"deviceSession":"boot1" } } })");
  TEST_ASSERT_TRUE(c.valid); TEST_ASSERT_TRUE(c.automatic); TEST_ASSERT_FALSE(c.pump1);
  for (const auto body : {R"({"commands":{},"pumps":{"pump1":true,"pump2":true}})",
    R"({"commands":{"pumps":{"pump1":trueX,"pump2":false}}})",
    R"({"commands":{"pumps":{"pump1":true,"pump2":false,"mode":"invalid"}}})",
    R"({"commands":{"pumps":{"pump1":false,"pump2":false,"mode":"automatic"}}})",
    R"({"commands":{"pumps":{"pump1":false,"pump2":false,"mode":"automatic","session":"s","revision":-1,"deviceSession":"b"}}})"}) {
    TEST_ASSERT_FALSE(parsePumpCommand(body).valid);
  }
  c=parsePumpCommand(R"({"commands":{"pumps":{"pump1":true,"pump2":false}}})");
  TEST_ASSERT_TRUE(c.valid); TEST_ASSERT_FALSE(c.automatic);
}
void authority_replay_and_loss() {
  PumpControl p;
  auto c=parsePumpCommand(R"({"commands":{"pumps":{"pump1":false,"pump2":false,"mode":"manual","session":"s1","revision":1,"deviceSession":"b1"}}})");
  p.command(c,"b1",0);
  c.automatic=true; c.revision=2; p.command(c,"b1",1);
  TEST_ASSERT_TRUE(p.fill.enabled);
  p.safety(2,false); TEST_ASSERT_FALSE(p.fill.enabled);
  p.command(c,"b1",3); TEST_ASSERT_FALSE(p.fill.enabled); // same revision cannot rearm
  const std::string ack=R"({"commands":{"pumps":{"pump1":false,"pump2":false,"mode":"manual","session":"s1","revision":3,"deviceSession":"b1","requestNonce":"n","tripAck":1}}})";
  TEST_ASSERT_TRUE(applyPumpResponse(p,ack,"b1","n",3,3,1));
  c.revision=4; p.command(c,"b1",4); TEST_ASSERT_TRUE(p.fill.enabled);
  p.safety(8005,true); TEST_ASSERT_FALSE(p.fill.enabled);
  p.command(c,"b1",8006); TEST_ASSERT_FALSE(p.fill.enabled);
  c.session="s2"; c.revision=100; p.command(c,"b1",8007); TEST_ASSERT_FALSE(p.fill.enabled);
  const std::string ack2=R"({"commands":{"pumps":{"pump1":false,"pump2":false,"mode":"manual","session":"s2","revision":100,"deviceSession":"b1","requestNonce":"n2","tripAck":2}}})";
  TEST_ASSERT_TRUE(applyPumpResponse(p,ack2,"b1","n2",8007,8007,2));
  c.automatic=false;
  c.automatic=true; c.revision=101; p.command(c,"b1",8008); TEST_ASSERT_TRUE(p.fill.enabled);
  c.deviceSession="oldboot"; c.revision=102; p.command(c,"b1",8009); TEST_ASSERT_TRUE(p.fill.enabled);
  c.deviceSession="b1"; c.revision=103; c.automatic=false; c.pump1=c.pump2=false;
  p.command(c,"b1",8010); TEST_ASSERT_FALSE(p.fill.enabled);
  c.automatic=true; c.revision=102; p.command(c,"b1",8011); TEST_ASSERT_FALSE(p.fill.enabled);
  c.automatic=false; c.revision=104; c.pump1=true;
  p.command(c,"b1",8012); TEST_ASSERT_TRUE(p.pump1);
  p.safety(16013,true); TEST_ASSERT_FALSE(p.pump1);
  p.command(c,"b1",16014); TEST_ASSERT_FALSE(p.pump1); // spent manual ON is also latched
}
void retired_session_cannot_rearm_or_stop_new_authority() {
  PumpControl p;
  auto c=parsePumpCommand(R"({"commands":{"pumps":{"pump1":false,"pump2":false,"mode":"manual","session":"old","revision":1,"deviceSession":"boot"}}})");
  p.command(c,"boot",1);
  c.pump1=true; c.revision=2; p.command(c,"boot",2);
  p.safety(8003,true); TEST_ASSERT_FALSE(p.pump1);
  const std::string ack=R"({"commands":{"pumps":{"pump1":false,"pump2":false,"mode":"manual","session":"new","revision":1,"deviceSession":"boot","requestNonce":"n","tripAck":1}}})";
  TEST_ASSERT_TRUE(applyPumpResponse(p,ack,"boot","n",8004,8004,1));
  c.session="new"; c.revision=1; c.pump1=false;
  c.session="old"; c.revision=2; c.pump1=true; p.command(c,"boot",8005);
  TEST_ASSERT_FALSE(p.pump1);
  c.session="new"; c.revision=2; p.command(c,"boot",8006); TEST_ASSERT_TRUE(p.pump1);
  c.session="old"; c.pump1=false; p.command(c,"boot",8007); TEST_ASSERT_TRUE(p.pump1);
}
void baseline_requires_new_revision_to_enable() {
  PumpControl p; PumpCommand c; c.valid=c.versioned=true; c.deviceSession="boot"; c.session="s"; c.revision=7;
  p.command(c,"boot",0); c.pump1=true; p.command(c,"boot",1); TEST_ASSERT_FALSE(p.pump1);
  c.revision=8; p.command(c,"boot",2); TEST_ASSERT_TRUE(p.pump1);
}
void unknown_on_legacy_and_retirement_capacity_fail_closed() {
  PumpControl p; PumpCommand c; c.valid=c.versioned=true; c.deviceSession="boot"; c.session="s0"; c.revision=1;
  c.pump1=true; p.command(c,"boot",0); TEST_ASSERT_FALSE(p.pump1); TEST_ASSERT_TRUE(p.session.empty());
  c.versioned=false; p.command(c,"boot",1); TEST_ASSERT_FALSE(p.pump1);
  c.versioned=true; c.pump1=false; p.command(c,"boot",2);
  for (size_t i=1;i<=PumpControl::kRetiredLimit;i++) {
    c.session="s"+std::to_string(i); c.revision=1; p.command(c,"boot",3+i);
  }
  c.pump1=true; c.revision=2; p.command(c,"boot",30); TEST_ASSERT_TRUE(p.pump1);
  c.session="overflow"; c.pump1=false; c.revision=1; p.command(c,"boot",31);
  TEST_ASSERT_TRUE(p.sessionsExhausted); TEST_ASSERT_FALSE(p.pump1);
  c.session="s16"; c.pump1=true; c.revision=3; p.command(c,"boot",32); TEST_ASSERT_FALSE(p.pump1);
}
void response_gate_rejects_unmatched_and_expired_replies() {
  PumpControl p; const std::string boot="boot";
  const std::string good=R"({"commands":{"pumps":{"pump1":false,"pump2":false,"mode":"manual","session":"s","revision":1,"deviceSession":"boot","requestNonce":"n1"}}})";
  TEST_ASSERT_FALSE(applyPumpResponse(p,good,boot,"n2",0,1));
  TEST_ASSERT_TRUE(p.session.empty());
  TEST_ASSERT_FALSE(applyPumpResponse(p,good,boot,"n1",0,8001));
  TEST_ASSERT_TRUE(p.session.empty());
  TEST_ASSERT_TRUE(applyPumpResponse(p,good,boot,"n1",0,100));
  TEST_ASSERT_EQUAL_STRING("s",p.session.c_str());
}
void response_started_before_watchdog_trip_cannot_rearm() {
  PumpControl p; PumpCommand c; c.valid=c.versioned=true; c.deviceSession="boot"; c.session="s"; c.revision=1;
  p.command(c,"boot",0); c.revision=2; c.pump1=true; p.command(c,"boot",1);
  const uint32_t generation=p.faultGeneration;
  p.safety(8002,true);
  const std::string response=R"({"commands":{"pumps":{"pump1":true,"pump2":false,"mode":"manual","session":"s","revision":3,"deviceSession":"boot","requestNonce":"n"}}})";
  TEST_ASSERT_FALSE(applyPumpResponse(p,response,"boot","n",1000,8003,generation));
  TEST_ASSERT_FALSE(p.pump1);
}
void higher_revision_from_after_trip_cannot_rearm_without_fault_acknowledgement() {
  PumpControl p; PumpCommand c; c.valid=c.versioned=true; c.deviceSession="boot"; c.session="s"; c.revision=1;
  p.command(c,"boot",0); c.revision=2; c.pump1=true; p.command(c,"boot",1);
  p.safety(8002,true);
  const std::string response=R"({"commands":{"pumps":{"pump1":true,"pump2":false,"mode":"manual","session":"s","revision":3,"deviceSession":"boot","requestNonce":"n"}}})";
  applyPumpResponse(p,response,"boot","n",8003,8004,p.faultGeneration);
  TEST_ASSERT_FALSE(p.pump1);
}
void trip_ack_requires_matching_off_and_fresh_on() {
  PumpControl p; PumpCommand c; c.valid=c.versioned=true; c.deviceSession="b"; c.session="s"; c.revision=1;
  p.command(c,"b",1); c.pump1=true; c.revision=2; p.command(c,"b",2); p.safety(8003,true);
  const std::string bad=R"({"commands":{"pumps":{"pump1":false,"pump2":false,"mode":"manual","session":"s","revision":3,"deviceSession":"b","requestNonce":"n","tripAck":2}}})";
  const std::string ack=R"({"commands":{"pumps":{"pump1":false,"pump2":false,"mode":"manual","session":"s","revision":3,"deviceSession":"b","requestNonce":"n","tripAck":1}}})";
  TEST_ASSERT_FALSE(applyPumpResponse(p,bad,"b","n",8004,8004,1));
  TEST_ASSERT_TRUE(p.tripPending); TEST_ASSERT_TRUE(applyPumpResponse(p,ack,"b","n",8004,8004,1));
  TEST_ASSERT_FALSE(p.pump1); c.revision=3; p.command(c,"b",8005); TEST_ASSERT_FALSE(p.pump1);
  c.revision=4; p.command(c,"b",8006); TEST_ASSERT_TRUE(p.pump1);
}
int main() { UNITY_BEGIN(); RUN_TEST(trip_ack_requires_matching_off_and_fresh_on); RUN_TEST(higher_revision_from_after_trip_cannot_rearm_without_fault_acknowledgement); RUN_TEST(protocol_scope_and_types); RUN_TEST(authority_replay_and_loss); RUN_TEST(retired_session_cannot_rearm_or_stop_new_authority); RUN_TEST(baseline_requires_new_revision_to_enable); RUN_TEST(unknown_on_legacy_and_retirement_capacity_fail_closed); RUN_TEST(response_gate_rejects_unmatched_and_expired_replies); RUN_TEST(response_started_before_watchdog_trip_cannot_rearm); return UNITY_END(); }
