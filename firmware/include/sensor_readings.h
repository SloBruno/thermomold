#pragma once

#include <cmath>

constexpr float kAjSr04mSoundSpeedMmPerUs = 0.343f;

inline bool isValidTemperatureReading(double temperatureC) {
  return std::isfinite(temperatureC);
}

inline unsigned long distanceMmFromEchoUs(unsigned long echoDurationUs) {
  return static_cast<unsigned long>((echoDurationUs * kAjSr04mSoundSpeedMmPerUs) / 2.0f);
}

inline bool isValidLevelDistanceMm(unsigned long distanceMm) {
  return distanceMm > 0;
}
