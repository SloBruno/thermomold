// ThermoMold - isolated MAX6675 diagnostic (does NOT share code with firmware/).
// - No Wi-Fi, no LittleFS/NVS access (production config is left untouched).
// - Relay inputs D19/D33 driven LOW (relay OFF, active level is HIGH) before anything else.
// - Reads both MAX6675 every 500 ms (> 220 ms max conversion time, datasheet).
//
// Variants (~45 s each, one pass after reset):
//   A  robtillaart/MAX6675 SW SPI, swSPIdelay = 0 (as production)
//   B  robtillaart/MAX6675 SW SPI, setSWSPIdelay(20)
//   C  hand-written bit-bang per datasheet (CS low, >=2 us before first sample,
//      SCK ~100 kHz, bit sampled while SCK low, i.e. after the falling edge
//      that shifts it out), both sensors read back to back each period
//   D  same as C, one sensor at a time: sensor 1 alone for half of the time, then
//      sensor 2 alone; the idle sensor's CS is held HIGH and its SCK LOW.
//
// Line format:
//   R,<variant>,<t_ms>,<sensor>,0x<hex>,<bin16>,D15=<b>,D2=<b>,D1=<b>,D0=<b>,<tempC>,<OK|BAD>
// Stats line per variant/sensor:
//   S,<variant>,<sensor>,n=..,valid=..,mean=..,min=..,max=..,sd=..,invalid=..,(d15=..,d2=..,d1=..,ffff=..,zero=..),jumps>5C=..
#include <Arduino.h>
#include <MAX6675.h>
#include <math.h>

namespace {
constexpr uint8_t kRelay1Pin = 19;
constexpr uint8_t kRelay2Pin = 33;

struct Pins { uint8_t sck, cs, so; };
constexpr Pins kSensor[2] = {{32, 21, 27}, {18, 23, 22}};

constexpr uint32_t kPeriodMs = 500;
constexpr uint32_t kVariantMs = 45000;

struct Stats {
  uint32_t n = 0, valid = 0, invalid = 0, d15 = 0, d2 = 0, d1 = 0, ffff = 0, zero = 0, jumps = 0;
  double sum = 0, sumSq = 0, minC = 1e9, maxC = -1e9, lastC = NAN;
};
Stats stats[2];

void relaysOff() {
  digitalWrite(kRelay1Pin, LOW);
  digitalWrite(kRelay2Pin, LOW);
  pinMode(kRelay1Pin, OUTPUT);
  pinMode(kRelay2Pin, OUTPUT);
  digitalWrite(kRelay1Pin, LOW);
  digitalWrite(kRelay2Pin, LOW);
}

void idlePins() {
  for (const Pins &p : kSensor) {
    pinMode(p.cs, OUTPUT);
    digitalWrite(p.cs, HIGH);
    pinMode(p.sck, OUTPUT);
    digitalWrite(p.sck, LOW);
    pinMode(p.so, INPUT);
  }
}

bool wordInvalid(uint16_t raw) {
  return raw == 0xFFFF || (raw & 0x8000) || (raw & 0x0002) || (raw & 0x0004);
}

void record(char variant, int sensor, uint16_t raw) {
  const int d15 = (raw >> 15) & 1, d2 = (raw >> 2) & 1, d1 = (raw >> 1) & 1, d0 = raw & 1;
  const double tempC = ((raw >> 3) & 0x0FFF) * 0.25;
  const bool bad = wordInvalid(raw);
  char bin[17];
  for (int i = 0; i < 16; ++i) bin[i] = (raw & (0x8000 >> i)) ? '1' : '0';
  bin[16] = 0;
  Serial.printf("R,%c,%lu,%d,0x%04X,%s,D15=%d,D2=%d,D1=%d,D0=%d,%.2f,%s\n", variant,
                (unsigned long)millis(), sensor + 1, raw, bin, d15, d2, d1, d0, tempC,
                bad ? "BAD" : "OK");
  Stats &s = stats[sensor];
  s.n++;
  if (raw == 0xFFFF) s.ffff++;
  if (raw == 0x0000) s.zero++;
  if (d15) s.d15++;
  if (d2) s.d2++;
  if (d1) s.d1++;
  if (bad) { s.invalid++; return; }
  s.valid++;
  s.sum += tempC;
  s.sumSq += tempC * tempC;
  if (tempC < s.minC) s.minC = tempC;
  if (tempC > s.maxC) s.maxC = tempC;
  if (!isnan(s.lastC) && fabs(tempC - s.lastC) > 5.0) s.jumps++;
  s.lastC = tempC;
}

void printStats(char variant) {
  for (int i = 0; i < 2; ++i) {
    const Stats &s = stats[i];
    double mean = NAN, sd = NAN;
    if (s.valid > 0) {
      mean = s.sum / s.valid;
      const double var = s.sumSq / s.valid - mean * mean;
      sd = sqrt(var > 0 ? var : 0);
    }
    Serial.printf("S,%c,%d,n=%lu,valid=%lu,mean=%.2f,min=%.2f,max=%.2f,sd=%.2f,invalid=%lu,"
                  "(d15=%lu,d2=%lu,d1=%lu,ffff=%lu,zero=%lu),jumps>5C=%lu\n",
                  variant, i + 1, (unsigned long)s.n, (unsigned long)s.valid, mean,
                  s.valid ? s.minC : NAN, s.valid ? s.maxC : NAN, sd, (unsigned long)s.invalid,
                  (unsigned long)s.d15, (unsigned long)s.d2, (unsigned long)s.d1,
                  (unsigned long)s.ffff, (unsigned long)s.zero, (unsigned long)s.jumps);
  }
}

// Datasheet: CS low -> D15 on SO within tDV (100 ns); data changes after SCK falling
// edge (tDO <= 100 ns); fSCK <= 4.3 MHz; tCSS >= 100 ns. Here: 2 us setup, 5 us high,
// 5 us low (~100 kHz), every bit sampled >= 5 us after the edge that presented it.
uint16_t bitBangRead(const Pins &p) {
  uint16_t raw = 0;
  digitalWrite(p.sck, LOW);
  digitalWrite(p.cs, LOW);
  delayMicroseconds(2);
  for (int i = 15; i >= 0; --i) {
    if (digitalRead(p.so)) raw |= (1u << i);
    digitalWrite(p.sck, HIGH);
    delayMicroseconds(5);
    digitalWrite(p.sck, LOW);
    delayMicroseconds(5);
  }
  digitalWrite(p.cs, HIGH);  // starts a new conversion
  return raw;
}

void waitUntil(uint32_t t) {
  while ((int32_t)(millis() - t) < 0) delay(1);
}

void runLibrary(char variant, uint16_t swDelay) {
  MAX6675 tc1(kSensor[0].cs, kSensor[0].so, kSensor[0].sck);
  MAX6675 tc2(kSensor[1].cs, kSensor[1].so, kSensor[1].sck);
  tc1.begin();
  tc2.begin();
  tc1.setSWSPIdelay(swDelay);
  tc2.setSWSPIdelay(swDelay);
  Serial.printf("# VARIANT %c start: robtillaart MAX6675 SW SPI swSPIdelay=%u\n", variant, swDelay);
  delay(300);  // let a fresh conversion complete
  const uint32_t start = millis();
  uint32_t next = start;
  while (millis() - start < kVariantMs) {
    waitUntil(next);
    next += kPeriodMs;
    tc1.read();
    record(variant, 0, tc1.getRawData());
    tc2.read();
    record(variant, 1, tc2.getRawData());
  }
}

void runBitBangBoth() {
  idlePins();
  Serial.println("# VARIANT C start: hand bit-bang ~100kHz, both sensors back to back");
  delay(300);
  const uint32_t start = millis();
  uint32_t next = start;
  while (millis() - start < kVariantMs) {
    waitUntil(next);
    next += kPeriodMs;
    record('C', 0, bitBangRead(kSensor[0]));
    record('C', 1, bitBangRead(kSensor[1]));
  }
}

void runBitBangSingle() {
  idlePins();
  Serial.println("# VARIANT D start: hand bit-bang ~100kHz, one sensor at a time (other CS HIGH)");
  for (int sensor = 0; sensor < 2; ++sensor) {
    idlePins();  // other sensor: CS HIGH, SCK LOW, untouched for the whole half
    Serial.printf("# VARIANT D: sensor %d only\n", sensor + 1);
    delay(300);
    const uint32_t start = millis();
    uint32_t next = start;
    while (millis() - start < kVariantMs / 2) {
      waitUntil(next);
      next += kPeriodMs;
      record('D', sensor, bitBangRead(kSensor[sensor]));
    }
  }
}

void resetStats() {
  for (Stats &s : stats) s = Stats();
}
}  // namespace

void setup() {
  relaysOff();
  idlePins();
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("# ThermoMold MAX6675 isolated diagnostic v1 (no Wi-Fi, no LittleFS)");
  Serial.printf("# sensor1 SCK=%u CS=%u SO=%u | sensor2 SCK=%u CS=%u SO=%u | period=%lums\n",
                kSensor[0].sck, kSensor[0].cs, kSensor[0].so, kSensor[1].sck, kSensor[1].cs,
                kSensor[1].so, (unsigned long)kPeriodMs);
  Serial.printf("# relays D19=%d D33=%d (LOW = OFF)\n", digitalRead(kRelay1Pin), digitalRead(kRelay2Pin));

  resetStats(); runLibrary('A', 0);  printStats('A');
  resetStats(); runLibrary('B', 20); printStats('B');
  resetStats(); runBitBangBoth();    printStats('C');
  resetStats(); runBitBangSingle();  printStats('D');
  idlePins();
  Serial.println("# DONE");
}

void loop() {
  relaysOff();
  delay(1000);
}
