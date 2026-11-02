import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import { createFlowCalibration } from '../src/flow-calibration.ts'
import { flowCalibrationRouter } from '../src/flow-calibration-routes.ts'
import { createPumpStore } from '../src/pumps.ts'

const telemetry = (now: number, pulses: number) => ({ deviceId: 'test', sensor: 'MAX6675' as const, temperatureC: 20,
  receivedAt: new Date(now).toISOString(), observedAt: new Date(now).toISOString(), pumps: { pump1: false, pump2: false },
  sensors: { thermocouples: [{ id: 'max6675-1' as const, temperatureC: 20 }, { id: 'max6675-2' as const, temperatureC: 20 }] as any,
    flow: { sensor: 'ZJ-S201' as const, totalLiters: pulses / 450, litersPerMinute: 1, rawTotalPulses: pulses, counterEpoch: 'boot', pulsesPerLiter: 450 } } })

test('isolated HTTP start / heartbeat / stop / status / abort never contacts hardware', async t => {
  let now = 10000
  const pumps = createPumpStore()
  const run = createFlowCalibration(pumps, () => now)
  const app = express().use(express.json()).use('/api/flow-calibration', flowCalibrationRouter(run))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as {port: number}).port}/api/flow-calibration`
  const post = (path: string, body = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await post('/start', { referenceMl: 500 })).status, 409)
  run.observe(telemetry(now, 100))
  assert.equal((await post('/start', { referenceMl: 0 })).status, 409)
  const start = await post('/start', { referenceMl: 500 })
  assert.equal(start.status, 200)
  const state = await start.json()
  assert.deepEqual(pumps.get(), { pump1: true, pump2: true })
  assert.equal((await post('/start', { referenceMl: 500 })).status, 409)
  assert.equal((await post('/heartbeat', { id: 'wrong' })).status, 409)
  assert.equal((await post('/heartbeat', { id: state.id })).status, 200)
  now += 1000
  assert.equal((await (await post('/stop')).json()).phase, 'stopping')
  assert.deepEqual(pumps.get(), { pump1: false, pump2: false })
  now += 1000
  run.observe(telemetry(now, 325))
  assert.equal((await (await fetch(base)).json()).proposedFactor, 1)
  assert.equal((await post('/apply', { confirmed: true })).status, 404)
  assert.equal((await post('/abort')).status, 200)
})
