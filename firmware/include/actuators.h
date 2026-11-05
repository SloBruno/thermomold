#pragma once
#include <cstdint>
#include <string>
#include <ArduinoJson.h>

constexpr float kFlowPulsesPerSecondPerLpm = 7.5f;
// 5 s telemetry + 3 s transport margin; Wi-Fi loss remains immediate.
constexpr unsigned long kPumpCommandTimeoutMs = 8000;
inline float flowLitersPerMinute(unsigned long pulses, unsigned long windowMs) {
  if (windowMs == 0) return 0.0f;
  return (pulses * 1000.0f / windowMs) / kFlowPulsesPerSecondPerLpm;
}
inline float litersFromPulses(unsigned long pulses) {
  return pulses / (kFlowPulsesPerSecondPerLpm * 60.0f);
}
inline bool pumpCommandExpired(uint32_t last, uint32_t now, uint32_t timeout) {
  return static_cast<uint32_t>(now-last)>timeout;
}
struct PumpCommand {
  bool valid=false, pump1=false, pump2=false, automatic=false;
  bool versioned=false;
  std::string session, deviceSession;
  uint32_t revision=0;
};
// Decode only the exact commands.pumps path. Legacy commands stay manual.
inline PumpCommand parsePumpCommand(const std::string &body) {
  PumpCommand c;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return c;
  JsonVariantConst p=doc["commands"]["pumps"];
  if (!p.is<JsonObjectConst>() || !p["pump1"].is<bool>() || !p["pump2"].is<bool>()) return c;
  if (!p["mode"].isNull()) {
    if (!p["mode"].is<const char *>()) return c;
    const std::string mode=p["mode"].as<const char *>();
    if (mode!="manual" && mode!="automatic") return c;
    c.automatic=mode=="automatic";
  }
  const bool hasVersion=!p["session"].isNull() || !p["revision"].isNull() || !p["deviceSession"].isNull();
  if (hasVersion || c.automatic) {
    if (!p["session"].is<const char *>() || !p["deviceSession"].is<const char *>() || !p["revision"].is<uint32_t>()) return PumpCommand{};
    c.session=p["session"].as<const char *>(); c.deviceSession=p["deviceSession"].as<const char *>();
    if (c.session.empty() || c.session.size()>96 || c.deviceSession.empty() || c.deviceSession.size()>96) return PumpCommand{};
    c.versioned=true; c.revision=p["revision"].as<uint32_t>();
  }
  c.pump1=p["pump1"].as<bool>(); c.pump2=p["pump2"].as<bool>();
  if (c.automatic && (c.pump1 || c.pump2)) return PumpCommand{};
  c.valid=true;
  return c;
}
