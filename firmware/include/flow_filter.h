#pragma once

#include <cstdint>

#include "actuators.h"

// ZJ-S201 / YF-S201: 7.5 Hz per L/min, rated 1..30 L/min.
// At 30 L/min the sensor produces 225 Hz (period 4.44 ms, ~2.2 ms per half cycle
// at its ~50 % duty). A second FALLING edge less than 2 ms after the previous edge
// cannot come from the rotor: it is a glitch, ringing, or coupled relay noise.
// 2 ms keeps a 2.2x margin below the fastest real period and still allows up to
// 500 Hz (~66 L/min), far above the sensor's rated range.
constexpr uint32_t kFlowMinPulseIntervalUs = 2000;
// Sensor's rated minimum; slower trickles (or sparse noise) are reported as 0.
constexpr float kFlowMinimumLpm = 1.0f;
// Real flow spreads pulses across the window; a relay/EMI burst is clustered.
// Pulses must span at least half the window and never pause longer than this.
// 1 L/min = 133 ms between pulses, so 250 ms still allows real low flow.
constexpr uint32_t kFlowMaxPulseGapUs = 250000;

// State touched by the ISR. In firmware it is only accessed inside a critical section.
struct FlowPulseFilter {
  bool hasEdge = false;
  uint32_t lastEdgeUs = 0;   // last FALLING edge seen, accepted or not
  uint32_t accepted = 0;     // accepted pulses in the current window
  uint32_t firstAcceptedUs = 0;
  uint32_t lastAcceptedUs = 0;
  uint32_t maxGapUs = 0;
};

// Called for every FALLING edge with micros(). The line must have been quiet for
// kFlowMinPulseIntervalUs since the previous edge (any edge), so continuous
// high-frequency noise never produces counts. Unsigned math survives micros() rollover.
// always_inline: called from an IRAM ISR, so it must not end up as a flash-resident call.
inline __attribute__((always_inline)) bool flowPulseEdge(FlowPulseFilter &filter, uint32_t nowUs) {
  const bool quietLongEnough =
      !filter.hasEdge || static_cast<uint32_t>(nowUs - filter.lastEdgeUs) >= kFlowMinPulseIntervalUs;
  filter.hasEdge = true;
  filter.lastEdgeUs = nowUs;
  if (!quietLongEnough) return false;
  if (filter.accepted == 0) {
    filter.firstAcceptedUs = nowUs;
  } else {
    const uint32_t gap = nowUs - filter.lastAcceptedUs;
    if (gap > filter.maxGapUs) filter.maxGapUs = gap;
  }
  filter.lastAcceptedUs = nowUs;
  filter.accepted = filter.accepted + 1;
  return true;
}

struct FlowWindow {
  uint32_t pulses = 0;
  uint32_t windowMs = 0;
  uint32_t spanUs = 0;    // first to last accepted pulse
  uint32_t maxGapUs = 0;  // largest interval between accepted pulses
};

// Closes the current window (caller holds the critical section in firmware).
inline FlowWindow takeFlowWindow(FlowPulseFilter &filter, uint32_t windowMs) {
  FlowWindow window;
  window.pulses = filter.accepted;
  window.windowMs = windowMs;
  window.spanUs = filter.accepted > 1 ? filter.lastAcceptedUs - filter.firstAcceptedUs : 0;
  window.maxGapUs = filter.maxGapUs;
  filter.accepted = 0;
  filter.maxGapUs = 0;
  return window;
}

inline bool flowWindowLooksLikeRealFlow(const FlowWindow &window) {
  if (window.windowMs == 0 || window.pulses < 2) return false;
  if (flowLitersPerMinute(window.pulses, window.windowMs) < kFlowMinimumLpm) return false;
  if (window.spanUs < window.windowMs * 500UL) return false;  // >= half the window
  return window.maxGapUs <= kFlowMaxPulseGapUs;
}

struct FlowMeter {
  float lpm = 0.0f;
  uint32_t totalPulses = 0;
  uint32_t pendingPulses = 0;  // previous qualifying window awaiting confirmation
  bool previousQualified = false;
};

// Flow is confirmed only by two consecutive qualifying windows. The first window's
// pulses are held and credited once confirmed, so real flow is not lost; an isolated
// window (burst, glitch train) is discarded and never reaches the total.
inline void flowMeterUpdate(FlowMeter &meter, const FlowWindow &window) {
  if (!flowWindowLooksLikeRealFlow(window)) {
    meter.lpm = 0.0f;
    meter.pendingPulses = 0;
    meter.previousQualified = false;
    return;
  }
  if (!meter.previousQualified) {
    meter.lpm = 0.0f;
    meter.pendingPulses = window.pulses;
    meter.previousQualified = true;
    return;
  }
  meter.totalPulses += meter.pendingPulses + window.pulses;
  meter.pendingPulses = 0;
  meter.lpm = flowLitersPerMinute(window.pulses, window.windowMs);
}
