#pragma once
#include <cmath>
#include <cstdint>
// >750 ms without a NEW pair breaks continuous evidence (250 ms acquisition).
constexpr uint32_t kTemperatureSampleIntervalMs = 250;
constexpr uint32_t kTemperatureStaleMs = 750;
struct TemperatureAlarm {
 const char *state = "unknown";
 float deltaC = NAN;
 uint32_t lastSampleAt = 0, aboveSince = 0;
 bool hasSample = false, above = false;
 void reset() { state="unknown"; deltaC=NAN; above=false; hasSample=false; }
 void tick(uint32_t now) { if(hasSample && uint32_t(now-lastSampleAt)>kTemperatureStaleMs) reset(); }
 void sample(uint32_t now,float one,float two) {
  tick(now);
  if(!std::isfinite(one)||!std::isfinite(two)){reset();return;}
  if(hasSample && now==lastSampleAt)return; // a cached pair cannot advance persistence
  hasSample=true;lastSampleAt=now;deltaC=std::fabs(one-two);
  if(deltaC<=3){above=false;state="normal";return;}
  if(!above){above=true;aboveSince=now;}
  state=deltaC>5 ? "severe" : uint32_t(now-aboveSince)>=2000 ? "warning" : "pending";
 }
};
