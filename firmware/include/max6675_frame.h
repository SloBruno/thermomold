#pragma once

#include <stdint.h>
#include <cmath>

// MAX6675 16-bit frame decoding (datasheet, Maxim/Analog Devices):
//   D15     dummy sign bit, always 0
//   D14..D3 12-bit temperature, 0.25 C per count
//   D2      1 = thermocouple input open
//   D1      device ID, always 0
//   D0      three-state
// Status codes intentionally match robtillaart/MAX6675 so the telemetry contract
// (diagnostics.max6675Status) and the dashboard mapping stay unchanged.
constexpr uint8_t kMax6675StatusOk = 0x00;
constexpr uint8_t kMax6675StatusOpen = 0x04;
constexpr uint8_t kMax6675StatusNoRead = 0x80;
constexpr uint8_t kMax6675StatusNoCommunication = 0x81;

// SO line timing used by the hand-written read (datasheet: fSCK <= 4.3 MHz,
// tCSS >= 100 ns, data valid tDO <= 100 ns after the SCK falling edge).
constexpr uint32_t kMax6675CsSetupUs = 2;
constexpr uint32_t kMax6675HalfClockUs = 5;  // ~100 kHz SCK

struct Max6675Reading {
  uint8_t status;
  float celsius;
};

// D0 is tri-state, not validity evidence. A zero temperature word (D0 either
// value) is ambiguous: real 0 C and stuck-low SO cannot be distinguished here.
// Conservatively mark unavailable, retain the raw frame in diagnostics, and do
// not claim that this proves a communication fault or substitute 0 C.
inline Max6675Reading decodeMax6675Frame(uint16_t raw) {
  if (raw == 0xFFFF || (raw & 0x8002u) != 0) {
    return {kMax6675StatusNoCommunication, NAN};
  }
  if ((raw & 0x0004u) != 0) return {kMax6675StatusOpen, NAN};
  if ((raw & 0xFFF8u) == 0) return {kMax6675StatusNoCommunication, NAN};
  return {kMax6675StatusOk, static_cast<float>(raw >> 3) * 0.25f};
}
