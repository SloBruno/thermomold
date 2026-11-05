"""Compile actual acquisition and control task entrypoints; inert GPIO/clock only."""
from pathlib import Path
import subprocess,tempfile,os
root=Path(__file__).resolve().parents[1]
s=(root/'src/main.cpp').read_text()
assert 'void updateTemperature()' in s, 'missing independent temperature acquisition'
acquisition=s[s.index('void updateTemperature()'):s.index('void controlCycle()')]
cycle=s[s.index('void controlCycle()'):s.index('void controlTask(')]
prefix=r'''
#include <cstdint>
#include <cmath>
#include "temperature_alarm.h"
#include "calibration.h"
#include "max6675_frame.h"
uint32_t clockMs=0,lastTemperatureReadMs=0;
unsigned reads=0,levelCalls=0,safetyCalls=0,lockDepth=0;
uint32_t millis(){return clockMs;}
int controlMutex=0,portMAX_DELAY=0;
void xSemaphoreTake(int,int){++lockDepth;} void xSemaphoreGive(int){--lockDepth;}
void enforcePumpFailSafe(){++safetyCalls;}
void updateLevel(unsigned long){++levelCalls;}
int kThermocoupleOnePins=0,kThermocoupleTwoPins=1,diagnosticSpiOne=0,diagnosticSpiTwo=0;
bool diagnosticHardwareSpi=false,serialDiagnostics=false;
uint16_t frames[2]={0x0308,0x0308};
uint16_t readMax6675Frame(int pin){if(lockDepth)std::abort();++reads;return frames[pin];}
uint16_t readHardwareDiagnostic(int,int pin){return readMax6675Frame(pin);}
void printTemperatureDiagnostics(uint16_t,uint16_t){}
CalibrationCommand calibration;
struct TemperatureSnapshot { uint16_t rawOne=0,rawTwo=0;float rawOneC=NAN,rawTwoC=NAN,oneC=NAN,twoC=NAN;uint32_t calibrationRevision=0,sampledAt=0;bool acquired=false; } temperature;
TemperatureAlarm temperatureAlarm;
'''
checks=r'''
int main(){
 calibration.revision=3;calibration.sensorOne={{0,3.125},{100,103.125}};calibration.sensorTwo={{0,-1.75},{100,98.25}};
 clockMs=249;controlCycle();if(reads)return 1;
 clockMs=250;controlCycle();if(reads!=2 || temperature.calibrationRevision!=3)return 2;
 if(std::fabs(temperature.oneC-temperature.twoC-4.875)>0.001)return 3;
 for(clockMs=255;clockMs<=2245;clockMs+=5)controlCycle();
 if(std::string(temperatureAlarm.state)!="pending")return 4;
 clockMs=2250;controlCycle();if(std::string(temperatureAlarm.state)!="warning")return 5;
 frames[1]=0x0200;clockMs=2500;controlCycle();if(std::string(temperatureAlarm.state)!="severe")return 6;
 frames[1]=4;clockMs=2750;controlCycle();if(std::string(temperatureAlarm.state)!="unknown")return 7;
 if(!std::isnan(temperature.twoC))return 8;
 if(levelCalls!=safetyCalls || lockDepth)return 9;
 puts("local acquisition + calibration + control integration: PASS");
}
'''
with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as d:
 cpp=Path(d)/'acquire.cpp';exe=Path(d)/'acquire'
 cpp.write_text('#include <cstdlib>\n#include <string>\n#include <cstdio>\n'+prefix+acquisition+cycle+checks)
 subprocess.run(['g++','-std=c++11','-I'+str(root/'include'),'-I'+str(root/'.pio/libdeps/native/ArduinoJson/src'),str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
