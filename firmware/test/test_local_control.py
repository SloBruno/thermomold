"""Compile actual firmware sensor/control cycle against inert clock/GPIO stubs."""
from pathlib import Path
import os, subprocess, tempfile
root=Path(__file__).resolve().parents[1]
s=(root/'src/main.cpp').read_text()
assert 'void controlCycle()' in s, 'missing independent local control cycle'
section=s[s.index('void updateLevel('):s.index('void updateTemperature()')] + s[s.index('void controlCycle()'):s.index('double calibratedFlowTotalLiters()')]
prefix=r'''
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <string>
#include "level_filter.h"
#include "pump_control.h"
using std::size_t;
uint32_t clockMs=0,nextReportAt=100000,levelDistanceMm=0,levelRawMm[5]={},nextLevelBurstAt=0;
uint32_t millis(){return clockMs;}
uint32_t pingLevelDistanceMm(){return 303;}
LevelBurst levelBurst;
PumpControl pumpControl;
int controlMutex=0;
const int portMAX_DELAY=0,WL_CONNECTED=1;
void xSemaphoreTake(int,int){} void xSemaphoreGive(int){}
struct Wifi {int status(){return 1;}} WiFi;
bool pump1On=false,pump2On=false;
void applyPumps(bool a,bool b){pump1On=a;pump2On=b;}
void enforcePumpFailSafe(){pumpControl.safety(millis(),WiFi.status()==WL_CONNECTED);applyPumps(pumpControl.pump1,pumpControl.pump2);}
void updateTemperature() {} // acquisition exercised in test_temperature_acquisition.py
void vTaskDelay(int){} int pdMS_TO_TICKS(int x){return x;}
'''
checks=r'''
int main(){
 pumpControl.hasCommand=true; pumpControl.lastCommand=0; pumpControl.fill.enable();
 for(clockMs=0;clockMs<2280;clockMs+=5) controlCycle();
 if(pump1On || pump2On) return 1; // first completed burst at 280ms, never count loop ticks
 controlCycle(); if(!pump1On || !pump2On) return 2;
 clockMs=8001; controlCycle(); if(pump1On || pump2On || pumpControl.fill.enabled) return 3;
 puts("independent local sensor/control regression: PASS");
}
'''
with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as d:
 cpp=Path(d)/'control.cpp'; exe=Path(d)/'control'
 cpp.write_text(prefix+section+checks)
 subprocess.run(['g++','-std=c++11','-I'+str(root/'include'),'-I'+str(root/'.pio/libdeps/native/ArduinoJson/src'),str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
