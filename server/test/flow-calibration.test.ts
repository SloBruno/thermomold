import assert from 'node:assert/strict'
import test from 'node:test'
import { createFlowCalibration } from '../src/flow-calibration.ts'
import { createPumpStore } from '../src/pumps.ts'
import type { TelemetrySample } from '../src/telemetry.ts'

export function sample(at: number, pulses = 100, extra = {}): TelemetrySample {
  return { deviceId: 'test-esp', sensor: 'MAX6675', temperatureC: 20,
    observedAt: new Date(at).toISOString(), receivedAt: new Date(at).toISOString(),
    pumps: { pump1: false, pump2: false }, sensors: {
      thermocouples: [{ id: 'max6675-1', temperatureC: 20 }, { id: 'max6675-2', temperatureC: 20 }],
      flow: { sensor: 'ZJ-S201', litersPerMinute: 2, totalLiters: pulses / 450,
        rawTotalPulses: pulses, counterEpoch: 'boot-1', pulsesPerLiter: 450, ...extra },
    } }
}

test('start commands both pumps; stop waits for a fresh OFF sample and only proposes a factor', () => {
  let now = 10000
  const pumps = createPumpStore()
  const run = createFlowCalibration(pumps, () => now)
  run.observe(sample(now))
  const started = run.start(500)
  assert.equal(started.phase, 'collecting')
  assert.deepEqual(pumps.get(), { pump1: true, pump2: true })
  now += 2000
  run.observe({ ...sample(now, 280), pumps: { pump1: true, pump2: true } })
  const stopped = run.stop()
  assert.equal(stopped.phase, 'stopping')
  assert.deepEqual(pumps.get(), { pump1: false, pump2: false })
  now += 1000
  run.observe(sample(now, 280))
  const result = run.get()
  assert.equal(result.phase, 'complete')
  assert.equal(result.elapsedMs, 2000)
  assert.equal(result.measuredMl, 400)
  assert.equal(result.pulses, 180)
  assert.equal(result.proposedFactor, 1.25)
  assert.equal(result.proposedPulsesPerLiter, 360)
  assert.equal(result.applied, false)
  assert.equal(run.heartbeat(started.id).phase, 'complete')
})

for (const fault of ['lease', 'telemetry', 'reset', 'backwards', 'missing', 'zero', 'zero-time', 'device', 'order', 'maximum']) {
  test(`fails safe and never proposes calibration on ${fault}`, () => {
    let now = 10000
    const pumps = createPumpStore()
    const run = createFlowCalibration(pumps, () => now)
    run.observe(sample(now))
    const started = run.start(500)
    if (fault === 'lease') { now += 5001; run.tick() }
    else if (fault === 'telemetry' || fault === 'maximum') {
      const until = now + (fault === 'maximum' ? 121000 : 13000)
      while (now < until && run.active()) {
        now += 1000
        run.heartbeat(started.id)
        if (fault === 'maximum') run.observe(sample(now, 100 + now))
      }
    } else {
      if (fault !== 'zero-time') now += 1000
      run.stop()
      now += 1000
      const next = sample(now, fault === 'zero' ? 100 : fault === 'backwards' ? 90 : 280,
        fault === 'reset' ? { counterEpoch: 'new-boot' } : fault === 'missing' ? { rawTotalPulses: undefined } : {})
      if (fault === 'device') next.deviceId = 'other-device'
      if (fault === 'order') next.observedAt = sample(10000).observedAt
      run.observe(next)
    }
    assert.equal(run.get().phase, 'failed')
    assert.equal(run.get().proposedFactor, undefined)
    assert.deepEqual(pumps.get(), { pump1: false, pump2: false })
  })
}

test('legacy filtered total is informational and never reconstructed into pulses or calibration', () => {
  let now = 10000
  const run = createFlowCalibration(createPumpStore(), () => now)
  const fields = { rawTotalPulses: undefined, counterEpoch: undefined, pulsesPerLiter: undefined }
  run.observe(sample(now, 100, fields))
  run.start(500)
  now += 1000; run.stop(); now += 1000
  run.observe(sample(now, 280, fields))
  assert.equal(run.get().phase, 'complete')
  assert.equal(run.get().source, 'filtered-total')
  assert.equal(run.get().pulses, undefined)
  assert.equal(run.get().proposedFactor, undefined)
})

test('invalid references, stale samples, existing pump commands and parallel sessions are rejected', () => {
  let now = 10000
  const pumps = createPumpStore()
  const run = createFlowCalibration(pumps, () => now)
  for (const ref of [0, -1, NaN, Infinity, '500', 1000001]) assert.throws(() => run.start(ref))
  assert.throws(() => run.start(500))
  run.observe(sample(now))
  pumps.set({ pump1: true })
  assert.throws(() => run.start(500))
  pumps.set({ pump1: false })
  now += 13000
  assert.throws(() => run.start(500))
  run.observe(sample(now))
  run.start(500)
  assert.throws(() => run.start(500))
  run.abort('teste')
  assert.deepEqual(pumps.get(), { pump1: false, pump2: false })
})
