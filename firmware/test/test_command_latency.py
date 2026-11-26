"""Offline fake-clock test of the actual main.cpp scheduling branch; no network or GPIO."""
from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'src/main.cpp').read_text()
loop = 'void loop() {\n' + source[source.index('  ensureWiFi();', source.index('void loop() {')):]
prefix = r'''
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include "telemetry_contract.h"
using u32 = uint32_t;
struct Payload { bool empty=true; bool isEmpty() const { return empty; } } pendingPayload;
u32 clockMs=0, nextOtaCheckAt=1000000, nextRetryAt=0, nextReportAt=0, retryDelayMs=2000;
const u32 kOtaCheckIntervalMs=900000;
int requests=0; u32 appliedAt=0;
unsigned long millis() { return clockMs; }
void ensureWiFi() {} void updateFlow() {} bool hasValidOtaTime() { return true; }
void checkForOtaUpdate() {} void scheduleRetry() {}
void reportTemperature() {
  ++requests;
  // Backend selects its response at start+100ms, full POST takes 200ms.
  bool includesCommand = clockMs+100 >= 101;
  clockMs += 200;
  if (includesCommand && !appliedAt) appliedAt=clockMs;
}
'''
checks = r'''
int main() {
  while (!appliedAt && clockMs<10000) { loop(); ++clockMs; }
  unsigned latency=appliedAt-101;
  std::printf("interval=%lu ms requests=%d command-to-apply=%u ms\n", minimumTelemetryIntervalMs(),requests,latency);
  if (requests!=2 || latency>1300) { std::fprintf(stderr,"command latency budget exceeded\n"); return 1; }
}
'''
with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as temp:
    cpp = Path(temp) / 'latency.cpp'; exe = Path(temp) / 'latency'
    cpp.write_text(prefix + loop + checks)
    subprocess.run(['g++', '-std=c++11', '-I', str(root/'include'), str(cpp), '-o', str(exe)], check=True)
    subprocess.run([str(exe)], check=True)
