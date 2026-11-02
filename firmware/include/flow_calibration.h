#pragma once
#include <cstdint>
// Operator approved the arithmetic mean of ALL three 500 mL trials:
// 27988/.5=55976; 24496/.5=48992; 24422/.5=48844 pulses/L.
// These are RAW ISR edges, not the old deglitched/confirmed counts.
constexpr double kCalibratedFlowPulsesPerLiter = (55976.0 + 48992.0 + 48844.0) / 3.0;
inline double rawFlowLiters(uint64_t rawPulses) {
  return static_cast<double>(rawPulses) / kCalibratedFlowPulsesPerLiter;
}
inline double rawFlowLpm(uint32_t rawEdges, uint32_t windowMs) {
  return windowMs == 0 ? 0.0 : rawFlowLiters(rawEdges) * 60000.0 / windowMs;
}
