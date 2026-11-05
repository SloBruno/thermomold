// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import TemperatureAlarm from './TemperatureAlarm'
import type { TelemetryStatus } from '../../../shared/types'
const audio=vi.hoisted(()=>({enable:vi.fn(async()=>{}),play:vi.fn(),stop:vi.fn(),dispose:vi.fn()}))
vi.mock('../lib/temperature-alarm-audio',()=>({AlarmAudio:class {enable=audio.enable;play=audio.play;stop=audio.stop;dispose=audio.dispose}}))
afterEach(()=>{cleanup();vi.clearAllMocks();vi.useRealTimers()})
function status(state='warning',deltaC:number|null=4):Extract<TelemetryStatus,{connected:true}> {
 return {connected:true,status:'online',stale:false,sample:{deviceId:'test',sensor:'MAX6675',temperatureC:20,observedAt:new Date().toISOString(),receivedAt:new Date().toISOString(),sensors:{thermocouples:[{id:'max6675-1',temperatureC:20},{id:'max6675-2',temperatureC:deltaC===null?null:20+deltaC}]},temperatureAlarm:{state:state as any,deltaC}}}
}
test('device warning is yellow; gesture enables, mute stops only audio; severe red',async()=>{
 const view=render(<TemperatureAlarm telemetry={status()} />)
 expect(screen.getByRole('alert').className).toContain('yellow')
 expect(audio.play).not.toHaveBeenCalled()
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Ativar som'})))
 expect(audio.play).toHaveBeenCalledWith('warning')
 fireEvent.click(screen.getByRole('button',{name:'Silenciar'}));expect(audio.stop).toHaveBeenCalled()
 expect(screen.getByText(/Atenção/)).toBeTruthy()
 view.rerender(<TemperatureAlarm telemetry={status('severe',6)} />)
 expect(screen.getByRole('alert').className).toContain('red')
 expect(screen.getByText(/Grave/)).toBeTruthy()
 expect(screen.getByText(/Som silenciado/)).toBeTruthy()
 view.unmount();expect(audio.dispose).toHaveBeenCalled()
})
test('stale, invalid, unknown, legacy and fetch failure never show normal or sound',()=>{
 const view=render(<TemperatureAlarm telemetry={status('normal',2)} />)
 expect(screen.getByText(/Normal/)).toBeTruthy()
 const stale=status();stale.stale=true
 for(const telemetry of [stale,status('unknown',null),{...status(),sample:{...status().sample!,temperatureAlarm:undefined}},null]){
  view.rerender(<TemperatureAlarm telemetry={telemetry} />)
  expect(screen.queryByText(/Normal/)).toBeNull()
  expect(screen.getByText(/não confirmado|indisponível|desatualizados/i)).toBeTruthy()
 }
 expect(audio.play).not.toHaveBeenCalled()
})
test('does not infer persistence from cloud delta; local browser timeout invalidates cached data',()=>{
 vi.useFakeTimers();const sample=status('pending',4)
 render(<TemperatureAlarm telemetry={sample} />)
 act(()=>vi.advanceTimersByTime(2500))
 expect(screen.getByText(/Aguardando confirmação/)).toBeTruthy()
 act(()=>vi.advanceTimersByTime(13000))
 expect(screen.getByText(/desatualizados/)).toBeTruthy()
})
test('blocked audio is visible while severe visual remains',async()=>{
 audio.enable.mockRejectedValueOnce(new Error('blocked'))
 render(<TemperatureAlarm telemetry={status('severe',6)} />)
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Ativar som'})))
 expect(screen.getByText(/Som bloqueado/)).toBeTruthy();expect(screen.getByText(/Grave/)).toBeTruthy()
})
