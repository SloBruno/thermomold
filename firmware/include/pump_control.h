#pragma once
#include "actuators.h"
#include "auto_fill.h"

// All access is serialized by the firmware control mutex. Authority is volatile.
struct PumpControl {
  AutoFill fill;
  bool pump1=false, pump2=false, hasCommand=false, tripPending=false;
  uint32_t lastCommand=0, revision=0, faultGeneration=0;
  const char *faultReason="none";
  std::string session;
  // Never evict an old authority during a boot: eviction would permit replay.
  static constexpr size_t kRetiredLimit=16;
  std::string retired[kRetiredLimit];
  size_t retiredCount=0;
  bool sessionsExhausted=false;
  void stop() { fill.stop(); pump1=pump2=false; hasCommand=false; }
  void safety(uint32_t now, bool wifi) {
    if (hasCommand && (!wifi || pumpCommandExpired(lastCommand,now,kPumpCommandTimeoutMs))) {
      ++faultGeneration; tripPending=true; faultReason=wifi ? "watchdog" : "wifi"; stop();
    }
    if (!hasCommand) stop();
    fill.tick(now);
    if (fill.enabled) { pump1=fill.pump1; pump2=fill.pump2; }
  }
  void sample(uint32_t now,uint32_t mm) {
    fill.sample(now,mm);
    if (fill.enabled) { pump1=fill.pump1; pump2=fill.pump2; }
  }
  void command(const PumpCommand &c,const std::string &boot,uint32_t now) {
    if (!c.valid) { stop(); return; }
    // Legacy packets have no replay protection, including before first registration.
    if (!c.versioned || c.deviceSession!=boot || sessionsExhausted || tripPending) return;
    if (c.versioned) {
      if (c.session!=session) {
        for (size_t i=0;i<retiredCount;++i) if (retired[i]==c.session) return;
        // A new authority must first deliver a strictly OFF manual baseline.
        if (c.automatic || c.pump1 || c.pump2) return;
        if (!session.empty()) {
          if (retiredCount==kRetiredLimit) { sessionsExhausted=true; stop(); return; }
          retired[retiredCount++]=session;
        }
        session=c.session; revision=c.revision; stop();
      } else {
        if (c.revision<revision) return;
        if (c.revision==revision && (!hasCommand || c.automatic!=fill.enabled ||
            (!c.automatic && (c.pump1!=pump1 || c.pump2!=pump2)))) return;
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

// Called by the actual POST response path, under controlMutex. A response is
// authority only for its unique request and while that request remains fresh.
inline bool applyPumpResponse(PumpControl &p, const std::string &body,
    const std::string &boot, const std::string &nonce, uint32_t sent, uint32_t now, uint32_t generation=0) {
  p.safety(now,true);
  if (generation != p.faultGeneration) return false;
  JsonDocument doc;
  if (nonce.empty() || uint32_t(now-sent)>kPumpCommandTimeoutMs || deserializeJson(doc,body)) return false;
  JsonVariantConst n=doc["commands"]["pumps"]["requestNonce"];
  if (!n.is<const char *>() || nonce != n.as<const char *>()) return false;
  const PumpCommand c=parsePumpCommand(body);
  if (!c.valid || !c.versioned || c.deviceSession!=boot) return false;
  if (p.tripPending) {
    JsonVariantConst ack=doc["commands"]["pumps"]["tripAck"];
    if (!ack.is<uint32_t>() || ack.as<uint32_t>()!=p.faultGeneration || c.automatic || c.pump1 || c.pump2 || (c.session==p.session && c.revision<=p.revision)) return false;
    if (c.session!=p.session) {
      for (size_t i=0;i<p.retiredCount;++i) if (p.retired[i]==c.session) return false;
      if (!p.session.empty()) {
        if (p.retiredCount==PumpControl::kRetiredLimit) { p.sessionsExhausted=true; return false; }
        p.retired[p.retiredCount++]=p.session;
      }
    }
    p.tripPending=false; p.session=c.session; p.revision=c.revision; p.stop();
    p.lastCommand=now; p.hasCommand=true;
    return true;
  }
  p.command(c,boot,now);
  return true;
}
