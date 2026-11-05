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
  c.revision=3; p.command(c,"b1",4); TEST_ASSERT_TRUE(p.fill.enabled);
  p.safety(8005,true); TEST_ASSERT_FALSE(p.fill.enabled);
  p.command(c,"b1",8006); TEST_ASSERT_FALSE(p.fill.enabled);
  c.session="s2"; c.revision=100; p.command(c,"b1",8007); TEST_ASSERT_FALSE(p.fill.enabled);
  c.revision=101; p.command(c,"b1",8008); TEST_ASSERT_TRUE(p.fill.enabled);
  c.deviceSession="oldboot"; c.revision=102; p.command(c,"b1",8009); TEST_ASSERT_FALSE(p.fill.enabled);
  c.deviceSession="b1"; c.revision=103; c.automatic=false; c.pump1=c.pump2=false;
  p.command(c,"b1",8010); TEST_ASSERT_FALSE(p.fill.enabled);
  c.automatic=true; c.revision=102; p.command(c,"b1",8011); TEST_ASSERT_FALSE(p.fill.enabled);
  c.automatic=false; c.revision=104; c.pump1=true;
  p.command(c,"b1",8012); TEST_ASSERT_TRUE(p.pump1);
  p.safety(16013,true); TEST_ASSERT_FALSE(p.pump1);
  p.command(c,"b1",16014); TEST_ASSERT_FALSE(p.pump1); // spent manual ON is also latched
}
int main() { UNITY_BEGIN(); RUN_TEST(protocol_scope_and_types); RUN_TEST(authority_replay_and_loss); return UNITY_END(); }
