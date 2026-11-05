"""Host regression of the actual reportTemperature() path; never accesses hardware.
Run: python test/test_thermocouple_guardrails.py (uv + Zig, like test_loop_schedule.py).
"""
from pathlib import Path
import json
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'src/main.cpp').read_text()
report = source[source.index('void reportTemperature() {'):source.index('}  // namespace', source.index('void reportTemperature() {'))]
acquisition = source[source.index('void updateTemperature()'):source.index('void controlCycle()')]
prefix = r'''
#include <string>
#include <cstdio>
#include <cmath>
#include <iostream>
#include "max6675_frame.h"
#include "sensor_readings.h"
#include "telemetry_contract.h"
#include "calibration.h"
#include "pump_control.h"
#include "level_filter.h"
#include "temperature_alarm.h"
#define THERMOMOLD_FIRMWARE_VERSION "0.1.16"
int controlMutex=0,portMAX_DELAY=0;
void xSemaphoreTake(int,int){} void xSemaphoreGive(int){}
PumpControl pumpControl;
std::string flowCounterEpoch="test-boot";
class String : public std::string {
public:
  using std::string::string;
  String(const std::string& s):std::string(s) {}
  template<class T> String(T n):std::string(std::to_string(n)) {}
  unsigned length() const { return size(); }
  void remove(unsigned n) { erase(n); }
};
String operator+(const String& s, unsigned n) { return String(std::string(s)+std::to_string(n)); }
String operator+(const String& s, const char* v) { return String(std::string(s)+v); }
struct SerialFake { template<class... T> void printf(const char*, T...) {} void println(const char*) {} } Serial;
struct { String deviceId="test-device"; } config;
CalibrationCommand calibration;
String pendingPayload;
unsigned long retryDelayMs, kInitialRetryDelayMs=2000;
unsigned levelDistanceMm=350, levelRawMm[5]={350,351,349,350,350};
float flowLpm=2.4;
struct { unsigned totalPulses=450; } flowMeter;
bool pump1On=true, pump2On=false;
bool serialDiagnostics=false;
bool diagnosticHardwareSpi=false;
int diagnosticSpiOne=0,diagnosticSpiTwo=1;
unsigned long lastTemperatureReadMs=0;
unsigned long clockMs=1000;
unsigned long millis(){return clockMs;}
struct TemperatureSnapshot {uint16_t rawOne=0,rawTwo=0;float rawOneC=NAN,rawTwoC=NAN,oneC=NAN,twoC=NAN;uint32_t calibrationRevision=0,sampledAt=0;bool acquired=false;} temperature;
TemperatureAlarm temperatureAlarm;
void printTemperatureDiagnostics(uint16_t,uint16_t){}
void addRawFlowCountersToPayload(){
  pendingPayload=withRawFlowCounters(pendingPayload,450,"test-boot",450);
}
int kThermocoupleOnePins=0, kThermocoupleTwoPins=1;
uint16_t frames[2]; unsigned reads[2]={0,0}; bool postOk=true;
uint16_t readMax6675Frame(int pin) { ++reads[pin]; return frames[pin]; }
uint16_t readHardwareDiagnostic(int,int pin){return readMax6675Frame(pin);}
double litersFromPulses(unsigned pulses) { return pulses/450.0; }
double calibratedFlowTotalLiters(){return 1.0;}
void scheduleRetry() {}
bool postPayload(const String& s) { std::cout << s << '\n'; return postOk; }
'''
checks = r'''
int main() {
  calibration.revision=7;
  calibration.sensorOne={{0,1},{100,101}};
  calibration.sensorTwo={{0,2},{100,102}};
  const uint16_t cases[][2]={{0,0x0308},{0x0308,4},{0xffff,0},{0x0308,0x0400},{0x8000,0x0308},{1,0x0308}};
  for (const auto& pair:cases) { clockMs+=250; frames[0]=pair[0]; frames[1]=pair[1]; updateTemperature();reportTemperature(); }
  postOk=false; clockMs+=250;frames[0]=0; frames[1]=0x0308;updateTemperature(); reportTemperature();
  if (pendingPayload.empty() || reads[0]!=7 || reads[1]!=7) return 1;
  std::cout << pendingPayload << '\n';
}
'''
with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as temp:
    cpp = Path(temp) / 'guardrails.cpp'
    exe = Path(temp) / 'guardrails.exe'
    cpp.write_text(prefix + acquisition + report.replace('deserializeJson(payloadDocument, pendingPayload)', 'deserializeJson(payloadDocument, static_cast<const std::string&>(pendingPayload))').replace('serializeJson(payloadDocument, pendingPayload)', 'serializeJson(payloadDocument, static_cast<std::string&>(pendingPayload))') + checks)
    subprocess.run(['g++', '-std=c++11', '-I'+str(root/'include'), '-I'+str(root/'.pio/libdeps/native/ArduinoJson/src'), str(cpp), '-o', str(exe)], check=True)
    rows = [json.loads(line) for line in subprocess.check_output([str(exe)], text=True).splitlines()]
expected = [(1,26.25),(25.25,None),(None,2),(25.25,34),(None,26.25),(1,26.25),(1,26.25),(1,26.25)]
assert len(rows) == len(expected)
for row, (one,two) in zip(rows,expected):
    sensors = row['sensors']['thermocouples']
    assert row['temperatureC'] == one, row
    assert [s['temperatureC'] for s in sensors] == [one,two], row
    assert row['rawTemperatureC'] == sensors[0]['rawTemperatureC']
    for sensor, value, offset in zip(sensors,(one,two),(1,2)):
        assert sensor['rawTemperatureC'] == (None if value is None else value-offset), row
    assert row['sensors']['level']['distanceMm'] == 350, row
    assert row['sensors']['flow'] == {'sensor':'ZJ-S201','litersPerMinute':2.4,'totalLiters':1,'rawTotalPulses':450,'counterEpoch':'test-boot','pulsesPerLiter':450}, row
    assert row['pumps'] == {'pump1':True,'pump2':False}, row
    assert row['calibrationRevision'] == 7
    assert 'max6675Raw' in row['diagnostics']
    assert row['firmwareVersion'] == '0.1.16'
    assert row['temperatureAlarm']['state'] == ('unknown' if one is None or two is None else 'severe')
assert rows[-1] == rows[-2], 'retry must retain the exact independent readings'
print('thermocouple guardrails: PASS (actual report path, 8 payloads)')
