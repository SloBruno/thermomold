// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import RealSensorPage from '../pages/RealSensorPage'
import SimpleDashboardPage from '../pages/SimpleDashboardPage'

import SimpleSimulatorPage from '../pages/SimpleSimulatorPage'
vi.mock('../lib/socket',()=>({default:{on:vi.fn(),off:vi.fn(),emit:vi.fn()}}))
vi.mock('./FlowCalibrationPanel',()=>({default:()=>null}))
vi.mock('./FillingControl',()=>({default:()=>null}))
const sample={connected:true,status:'online',stale:false,sample:{deviceId:'test',sensor:'MAX6675',temperatureC:20,observedAt:new Date().toISOString(),receivedAt:new Date().toISOString(),sensors:{thermocouples:[{id:'max6675-1',temperatureC:20},{id:'max6675-2',temperatureC:26}]},temperatureAlarm:{state:'severe',deltaC:6}}}
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
test('actual real page and routed Dashboard mount exactly one real-sensor alarm; simulator never does',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>sample})))
 for(const Page of [RealSensorPage,SimpleDashboardPage]){
  const view=render(<Page />)
  await waitFor(()=>expect(screen.getByText(/Grave: ΔT/)).toBeTruthy())
  expect(screen.getAllByLabelText('Alarme dos termopares reais')).toHaveLength(1)
  view.unmount()
 }
 render(<SimpleSimulatorPage />)
 expect(screen.queryByLabelText('Alarme dos termopares reais')).toBeNull()
})
