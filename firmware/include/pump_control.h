#pragma once
#include "actuators.h"
#include "auto_fill.h"

// All access is serialized by the firmware control mutex. Authority is volatile.
struct PumpControl {
  AutoFill fill;
  bool pump1=false, pump2=false, hasCommand=false;
  uint32_t lastCommand=0, revision=0;
  std::string session;
  void stop() { fill.stop(); pump1=pump2=false; hasCommand=false; }
  void safety(uint32_t now, bool wifi) {
    if (!wifi || !hasCommand || pumpCommandExpired(lastCommand,now,kPumpCommandTimeoutMs)) stop();
    fill.tick(now);
    if (fill.enabled) { pump1=fill.pump1; pump2=fill.pump2; }
  }
  void sample(uint32_t now,uint32_t mm) {
    fill.sample(now,mm);
    if (fill.enabled) { pump1=fill.pump1; pump2=fill.pump2; }
  }
  void command(const PumpCommand &c,const std::string &boot,uint32_t now) {
    if (!c.valid || (c.versioned && c.deviceSession!=boot)) { stop(); return; }
    if (c.versioned) {
      if (c.session!=session) {
        session=c.session; revision=c.revision; stop();
        // A different backend session must establish a manual baseline first.
        if (c.automatic) return;
      } else {
        if (c.revision<revision) return;
        if (c.revision==revision && (!hasCommand || (c.automatic && !fill.enabled))) return;
      }
      if (c.automatic) {
        if (c.revision>revision) { fill.enable(); pump1=pump2=false; }
        revision=c.revision;
        lastCommand=now; hasCommand=true; return;
      }
      revision=c.revision;
    }
    fill.stop(); pump1=c.pump1; pump2=c.pump2;
    lastCommand=now; hasCommand=true;
  }
};
