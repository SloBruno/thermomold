// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SupervisoryPage from './SupervisoryPage'
vi.mock('../lib/socket', () => ({default:{on:vi.fn(),off:vi.fn()}}))
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
test('offline shows unavailable readings and prevents starting pumps', async()=>{
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>({ok:true,json:async()=>url.endsWith('/api/telemetry')?{status:'offline',stale:true,sample:null}:url.endsWith('/api/pumps')?{pump1:false,pump2:false}:{mode:'manual',session:'s',revision:1,deviceSession:''}})))
  render(<SupervisoryPage />)
  await screen.findByText('Offline')
  expect(screen.getAllByText('Indisponível').length).toBeGreaterThan(0)
  await waitFor(()=>expect((screen.getByRole('button',{name:'Ligar B1'}) as HTMLButtonElement).disabled).toBe(true))
  expect((screen.getByRole('button',{name:'Manual / Parar tudo'}) as HTMLButtonElement).disabled).toBe(false)
})

test('automatic mode blocks manual starts and invalid readings are unavailable', async()=>{
  const sample={receivedAt:new Date().toISOString(),observedAt:new Date().toISOString(),control:{mode:'automatic'},pumps:{pump1:true,pump2:false},sensors:{thermocouples:[{temperatureC:null},{temperatureC:NaN}],flow:{litersPerMinute:NaN}}}
  const fetcher=vi.fn(async (url:string, init?:RequestInit)=>({ok:true,json:async()=>init?{mode:'manual',session:'s',revision:2,deviceSession:'d'}:url.endsWith('/api/telemetry')?{status:'online',stale:false,sample}:url.endsWith('/api/pumps')?{pump1:true,pump2:false}:{mode:'automatic',session:'s',revision:1,deviceSession:'d'}}))
  vi.stubGlobal('fetch',fetcher)
  render(<SupervisoryPage />)
  await screen.findByText('Online')
  expect((screen.getByRole('button',{name:'Ligar B2'}) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getAllByText('Indisponível').length).toBeGreaterThan(2)
  fireEvent.click(screen.getByRole('button',{name:'Manual / Parar tudo'}))
  await waitFor(()=>expect(fetcher.mock.calls.some(c=>c[1]?.method==='POST' && c[0].endsWith('/api/filling') && c[1].body===JSON.stringify({mode:'manual'}))).toBe(true))
})

test('manual pump start uses the individual command endpoint', async()=>{
  const sample={receivedAt:new Date().toISOString(),observedAt:new Date().toISOString(),control:{mode:'manual'},pumps:{pump1:false,pump2:false},sensors:{thermocouples:[{temperatureC:20},{temperatureC:22}]}}
  const fetcher=vi.fn(async (url:string, init?:RequestInit)=>({ok:true,json:async()=>init?{pump1:true,pump2:false}:url.endsWith('/api/telemetry')?{status:'online',stale:false,sample}:url.endsWith('/api/pumps')?{pump1:false,pump2:false}:{mode:'manual',session:'s',revision:1,deviceSession:'d'}}))
  vi.stubGlobal('fetch',fetcher)
  render(<SupervisoryPage />)
  await waitFor(()=>expect((screen.getByRole('button',{name:'Ligar B1'}) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button',{name:'Ligar B1'}))
  await waitFor(()=>expect(fetcher.mock.calls.some(c=>c[0].endsWith('/api/pumps') && c[1]?.body===JSON.stringify({pump1:true}))).toBe(true))
})

test('stale data is not shown as current and cannot enable automatic', async()=>{
  const sample={receivedAt:new Date(Date.now()-20000).toISOString(),observedAt:new Date().toISOString(),temperatureC:42,control:{mode:'manual'},pumps:{pump1:true,pump2:false}}
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>({ok:true,json:async()=>url.endsWith('/api/telemetry')?{status:'online',stale:false,sample}:url.endsWith('/api/pumps')?{pump1:false,pump2:false}:{mode:'manual',session:'s',revision:1,deviceSession:'d'}})))
  render(<SupervisoryPage />)
  await screen.findByText('Dados desatualizados')
  expect(screen.queryByText('42.00 °C')).toBeNull()
  expect((screen.getByRole('button',{name:'Automático'}) as HTMLButtonElement).disabled).toBe(true)
})
