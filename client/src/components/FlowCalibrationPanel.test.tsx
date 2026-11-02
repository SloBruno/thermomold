// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FlowCalibrationPanel from './FlowCalibrationPanel'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const idle = { phase: 'idle', referenceMl: 500, sampleCount: 0, applied: false }
const reply = (body: object) => Promise.resolve({ ok: true, json: async () => body })

test('operator starts both pumps via session and stops; reference defaults to 500 mL', async () => {
  const fetcher = vi.fn((url: string) => reply(url.endsWith('/start')
    ? { ...idle, phase: 'collecting', id: 'run1', startedAt: Date.now() }
    : url.endsWith('/stop') ? { ...idle, phase: 'stopping' } : idle))
  vi.stubGlobal('fetch', fetcher)
  render(<FlowCalibrationPanel />)
  expect((screen.getByLabelText('Volume de referência (mL)') as HTMLInputElement).value).toBe('500')
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar — ligar as duas bombas' }))
  await screen.findByText('Coletando')
  const start = fetcher.mock.calls.find(([url]) => url.endsWith('/start')) as any
  expect(JSON.parse(start[1].body)).toEqual({ referenceMl: 500 })
  fireEvent.click(screen.getByRole('button', { name: 'Parar — desligar as duas bombas' }))
  await screen.findByText('Aguardando leitura final com comando OFF')
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/stop'))).toBe(true)
})

test('failed start attempts abort/OFF and shows a network warning', async () => {
  const fetcher = vi.fn((url: string) => url.endsWith('/start') ? Promise.reject(new Error('rede')) : reply(idle))
  vi.stubGlobal('fetch', fetcher)
  render(<FlowCalibrationPanel />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar — ligar as duas bombas' }))
  await screen.findByRole('alert')
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/abort'))).toBe(true)
})

test('filtered total never offers a made-up correction factor', async () => {
  vi.stubGlobal('fetch', vi.fn(() => reply({ ...idle, phase: 'complete', source: 'filtered-total', elapsedMs: 2000, measuredMl: 400 })))
  render(<FlowCalibrationPanel />)
  await screen.findByText(/400.00 mL/)
  expect(screen.getByText(/Sem contador bruto remoto/)).toBeTruthy()
  expect(screen.queryByText(/Fator proposto:/)).toBeNull()
})
