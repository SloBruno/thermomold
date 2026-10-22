#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>

#include "sensor_readings.h"

// AJ-SR04M mode 1 (R19 open). Datasheet trigger minimum is 10 us; many boards
// only fire reliably with a longer pulse, so use 20 us.
constexpr uint32_t kLevelTriggerPulseUs = 20;
constexpr size_t kLevelSamplesPerBurst = 5;
// Lets the previous ping's echoes (max 8 m round trip ~46.6 ms) die out.
constexpr uint32_t kLevelPingSpacingMs = 70;
constexpr size_t kLevelMinimumValidSamples = 3;
// Bounded pulseIn() wait: covers the 8 m round trip (46.6 ms) plus margin.
// This is also the worst-case time one ping can block loop().
constexpr uint32_t kLevelEchoTimeoutUs = 50000;

// Median of the samples inside the datasheet range; 0 (= unavailable) when
// fewer than kLevelMinimumValidSamples are valid. Even counts use the upper middle.
inline uint32_t medianValidLevelMm(const uint32_t *samples, size_t count) {
  uint32_t valid[kLevelSamplesPerBurst];
  size_t validCount = 0;
  for (size_t index = 0; index < count && validCount < kLevelSamplesPerBurst; ++index) {
    if (isValidLevelDistanceMm(samples[index])) valid[validCount++] = samples[index];
  }
  if (validCount < kLevelMinimumValidSamples) return 0;
  std::sort(valid, valid + validCount);
  return valid[validCount / 2];
}

// Non-blocking burst: loop() fires at most one ping per pass, spaced >= 70 ms,
// so the 5 measurements never stack up into one long blocking call.
struct LevelBurst {
  bool active = false;
  size_t count = 0;
  uint32_t lastPingMs = 0;
  uint32_t samples[kLevelSamplesPerBurst] = {0, 0, 0, 0, 0};
};

inline void levelBurstStart(LevelBurst &burst) {
  burst.active = true;
  burst.count = 0;
}

inline bool levelBurstPingDue(const LevelBurst &burst, uint32_t nowMs) {
  if (!burst.active || burst.count >= kLevelSamplesPerBurst) return false;
  return burst.count == 0 || static_cast<uint32_t>(nowMs - burst.lastPingMs) >= kLevelPingSpacingMs;
}

inline void levelBurstRecord(LevelBurst &burst, uint32_t nowMs, uint32_t distanceMm) {
  if (burst.count >= kLevelSamplesPerBurst) return;
  burst.samples[burst.count++] = distanceMm;
  burst.lastPingMs = nowMs;
}

inline bool levelBurstComplete(const LevelBurst &burst) {
  return burst.count >= kLevelSamplesPerBurst;
}

inline uint32_t levelBurstResultMm(const LevelBurst &burst) {
  return medianValidLevelMm(burst.samples, burst.count);
}
