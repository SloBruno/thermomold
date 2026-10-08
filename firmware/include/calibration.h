#pragma once

#include <cstdint>

struct CalibrationPoint {
  float rawC;
  float referenceC;
};

struct SensorCalibration {
  CalibrationPoint low;
  CalibrationPoint high;
};

struct CalibrationCommand {
  bool valid = false;
  uint32_t revision = 0;
  SensorCalibration sensorOne{};
  SensorCalibration sensorTwo{};
};

inline float applyTemperatureCalibration(float rawC, const SensorCalibration &calibration) {
  const float slope = (calibration.high.referenceC - calibration.low.referenceC) /
                      (calibration.high.rawC - calibration.low.rawC);
  return calibration.low.referenceC + (rawC - calibration.low.rawC) * slope;
}

inline bool calibrationRevisionIsNewer(uint32_t current, uint32_t candidate) {
  return static_cast<uint32_t>(candidate - current) < 0x80000000UL && candidate != current;
}
