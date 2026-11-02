"""Regression harness: compile the actual loop with a fake clock and blocking I/O.
Run: python test/test_loop_schedule.py (requires uv and ziglang tool)."""
from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'src/main.cpp').read_text()
# Exercise the normal network branch; local USB diagnostics are tested separately.
loop = 'void loop() {\n' + source[source.index('  ensureWiFi();', source.index('void loop() {')):]
prefix = r'''
#include <cstdint>
#include <cstdio>
#include <cstdlib>
using std::size_t;
using u32 = uint32_t;
struct Payload { bool empty = true; bool isEmpty() const { return empty; } void operator=(const char*) { empty = true; } } pendingPayload;
u32 clockMs, nextOtaCheckAt, nextRetryAt, nextReportAt, retryDelayMs;
const u32 kOtaCheckIntervalMs=900000, kInitialRetryDelayMs=2000, kLevelSamplesPerBurst=5;
u32 levelDistanceMm, levelRawMm[5], otaDelay, retryDelay, pingDelay, postDelay;
u32 reads[10]; int count;
unsigned long millis() { return clockMs; }
void ensureWiFi() {} void updateFlow() {} void enforcePumpFailSafe() {}
bool hasValidOtaTime() { return true; }
void checkForOtaUpdate() { clockMs += otaDelay; otaDelay=0; }
bool postPayload(const Payload&) { clockMs += retryDelay; retryDelay=0; return true; }
void scheduleRetry() {}
void updateLevel(unsigned long) { clockMs += pingDelay; pingDelay=0; }
unsigned long minimumTelemetryIntervalMs() { return 2500; }
void reportTemperature() { reads[count++] = clockMs; clockMs += postDelay; postDelay=0; }
'''
checks = r'''
void require(bool ok, const char* message) { if (!ok) { std::fprintf(stderr, "%s\n", message); std::exit(1); } }
int main() {
  clockMs=100; nextReportAt=100; nextOtaCheckAt=100; otaDelay=6000;
  loop(); loop(); require(count==1, "OTA caused consecutive sensor reads");
  clockMs=reads[0]+2499; loop(); require(count==1, "read before interval after OTA");
  clockMs=reads[0]+2500; loop(); require(count==2, "read not due after interval");
  count=0; clockMs=20000; nextReportAt=20000; nextOtaCheckAt=100000; pendingPayload.empty=false; nextRetryAt=20000; retryDelay=6000;
  loop(); loop(); require(count==1, "retry caused consecutive sensor reads");
  count=0; clockMs=40000; nextReportAt=40000; pingDelay=6000; loop(); loop(); require(count==1, "level ping caused consecutive sensor reads");
  count=0; clockMs=60000; nextReportAt=60000; postDelay=6000; loop(); loop(); require(count==1, "POST caused consecutive sensor reads");
  count=0; clockMs=0xfffffff0u; nextReportAt=clockMs; nextOtaCheckAt=clockMs+10000u; loop(); require(count==1, "rollover initial read missing");
  clockMs+=2499; loop(); require(count==1, "rollover read too early"); clockMs+=1; loop(); require(count==2, "rollover read missing");
  std::puts("loop scheduling regression: PASS");
}
'''
with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as temp:
    cpp = Path(temp) / 'loop.cpp'; exe = Path(temp) / 'loop.exe'
    cpp.write_text(prefix + loop + checks)
    subprocess.run(['g++', '-std=c++11', str(cpp), '-o', str(exe)], check=True)
    subprocess.run([str(exe)], check=True)
