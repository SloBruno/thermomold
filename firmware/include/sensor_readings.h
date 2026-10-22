#pragma once

#include <cmath>

constexpr float kAjSr04mSoundSpeedMmPerUs = 0.343f;

inline bool isValidTemperatureReading(double temperatureC) {
  return std::isfinite(temperatureC);
}

inline unsigned long distanceMmFromEchoUs(unsigned long echoDurationUs) {
  return static_cast<unsigned long>((echoDurationUs * kAjSr04mSoundSpeedMmPerUs) / 2.0f);
}

// AJ-SR04M datasheet / user manual (mode table): blind area 20 cm, furthest distance 8 m.
// Readings inside the blind zone are multipath/ringing artefacts, not a real surface.
constexpr unsigned long kAjSr04mBlindZoneMm = 200;
constexpr unsigned long kAjSr04mMaxRangeMm = 8000;

inline bool isValidLevelDistanceMm(unsigned long distanceMm) {
  return distanceMm >= kAjSr04mBlindZoneMm && distanceMm <= kAjSr04mMaxRangeMm;
}
