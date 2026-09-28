#pragma once

#include <cstdint>
#include <string>

// ZJ-S201 (YF-S201 family): pulse frequency Hz = 7.5 * flow L/min.
// Calibrate this constant against a measured volume if readings drift.
constexpr float kFlowPulsesPerSecondPerLpm = 7.5f;
// Default pump command timeout: no successful backend response for this long -> pumps OFF.
constexpr unsigned long kPumpCommandTimeoutMs = 3000;

inline float flowLitersPerMinute(unsigned long pulses, unsigned long windowMs) {
  if (windowMs == 0) return 0.0f;
  const float pulsesPerSecond = (pulses * 1000.0f) / windowMs;
  return pulsesPerSecond / kFlowPulsesPerSecondPerLpm;
}

inline float litersFromPulses(unsigned long pulses) {
  return pulses / (kFlowPulsesPerSecondPerLpm * 60.0f);
}

// millis() is 32-bit on ESP32; fixed-width unsigned subtraction stays correct across rollover.
inline bool pumpCommandExpired(uint32_t lastCommandAtMs, uint32_t nowMs, uint32_t timeoutMs) {
  return static_cast<uint32_t>(nowMs - lastCommandAtMs) > timeoutMs;
}

struct PumpCommand {
  bool valid = false;
  bool pump1 = false;
  bool pump2 = false;
};

namespace pump_command_detail {
// Returns 1 for true, 0 for false, -1 when the key is missing or not a boolean.
inline int readBool(const std::string &object, const std::string &key) {
  const std::string needle = "\"" + key + "\":";
  const size_t at = object.find(needle);
  if (at == std::string::npos) return -1;
  const size_t valueAt = at + needle.size();
  if (object.compare(valueAt, 4, "true") == 0) return 1;
  if (object.compare(valueAt, 5, "false") == 0) return 0;
  return -1;
}
}  // namespace pump_command_detail

// Parses {"commands":{"pumps":{"pump1":bool,"pump2":bool}}} from the backend response.
// Any missing or malformed field yields an invalid, all-off command (fail-safe).
inline PumpCommand parsePumpCommand(const std::string &body) {
  PumpCommand command;
  const std::string marker = "\"pumps\":{";
  const size_t start = body.find(marker);
  if (start == std::string::npos) return command;
  const size_t end = body.find('}', start + marker.size());
  if (end == std::string::npos) return command;

  const std::string object = body.substr(start + marker.size(), end - start - marker.size());
  const int pump1 = pump_command_detail::readBool(object, "pump1");
  const int pump2 = pump_command_detail::readBool(object, "pump2");
  if (pump1 < 0 || pump2 < 0) return command;

  command.valid = true;
  command.pump1 = pump1 == 1;
  command.pump2 = pump2 == 1;
  return command;
}
