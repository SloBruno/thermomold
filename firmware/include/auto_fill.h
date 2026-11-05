#pragma once
#include <cstdint>
#include "sensor_readings.h"

// Local-only decision. Call sample ONCE per completed, newly acquired burst.
struct AutoFill {
  bool enabled=false, pump1=false, pump2=false;
  bool pending=false, hasValid=false;
  int candidate=-1;
  uint32_t since=0, lastValid=0;
  void reset() { pump1=pump2=false; pending=hasValid=false; candidate=-1; }
  void enable() { enabled=true; reset(); }
  void stop() { enabled=false; reset(); }
  void tick(uint32_t now) {
    if (enabled && hasValid && uint32_t(now-lastValid)>2000) reset();
  }
  void sample(uint32_t now, uint32_t mm) {
    if (!enabled) return;
    tick(now);
    if (!isValidLevelDistanceMm(mm)) { pending=false; return; }
    if (hasValid && uint32_t(now-lastValid)>600) pending=false;
    hasValid=true; lastValid=now;
    // 333 mm empty; 293 mm full. Integer comparisons preserve exact 75/95 boundaries.
    const int zone = mm>=303 ? 2 : mm>295 ? 1 : 0;
    if (!pending || candidate!=zone) { candidate=zone; since=now; pending=true; }
    if (uint32_t(now-since)>=2000) { pump1=zone>=1; pump2=zone==2; }
  }
};
