import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTelemetry } from '../src/telemetry.js'
const sensors = (one: number | null=20,two: number | null=24) => ({thermocouples:[{id:'max6675-1',temperatureC:one},{id:'max6675-2',temperatureC:two}]})
const base={deviceId:'test-device',temperatureC:20,sensors:sensors()}
test('preserves optional device-authoritative alarm and running firmware; legacy unchanged',()=>{
 const result=normalizeTelemetry({...base,firmwareVersion:'0.1.16',temperatureAlarm:{state:'warning',deltaC:4}} as any)
 assert.equal(result.ok,true)
 if(result.ok){assert.deepEqual((result.value as any).temperatureAlarm,{state:'warning',deltaC:4});assert.equal((result.value as any).firmwareVersion,'0.1.16')}
 const legacy=normalizeTelemetry(base);assert.equal(legacy.ok,true)
 if(legacy.ok)assert.equal((legacy.value as any).temperatureAlarm,undefined)
})
test('rejects malformed and contradictory alarm snapshots, accepts unknown failure',()=>{
 for(const alarm of [null,[],{state:'warning',deltaC:3},{state:'severe',deltaC:4},{state:'normal',deltaC:4},{state:'pending',deltaC:6},{state:'unknown',deltaC:4},{state:'warning',deltaC:Infinity},{state:'bad',deltaC:4},{state:'warning',deltaC:4.2}]){
  assert.equal(normalizeTelemetry({...base,temperatureAlarm:alarm} as any).ok,false,JSON.stringify(alarm))
 }
 assert.equal(normalizeTelemetry({...base,sensors:sensors(20,null),temperatureAlarm:{state:'warning',deltaC:4}} as any).ok,false)
 assert.equal(normalizeTelemetry({...base,sensors:sensors(20,null),temperatureAlarm:{state:'unknown',deltaC:null}} as any).ok,true)
 for(const [state,one,two,deltaC] of [['normal',20,23,3],['pending',20,25,5],['warning',20,25,5],['severe',26,20,6]] as const){
  assert.equal(normalizeTelemetry({...base,temperatureC:one,sensors:sensors(one,two),temperatureAlarm:{state,deltaC}} as any).ok,true)
 }
})
