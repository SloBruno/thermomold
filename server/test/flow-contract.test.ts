import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTelemetry } from '../src/telemetry.ts'

const payload = (flow: object) => ({ deviceId: 'test', temperatureC: 20, sensors: {
  thermocouples: [{ id: 'max6675-1', temperatureC: 20 }, { id: 'max6675-2', temperatureC: 20 }],
  flow: { sensor: 'ZJ-S201', totalLiters: 1, litersPerMinute: 1, ...flow },
} })

test('preserves remote cumulative raw counter with epoch and conversion', () => {
  const result = normalizeTelemetry(payload({ rawTotalPulses: 450, counterEpoch: 'boot1', pulsesPerLiter: 450 }))
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.sensors?.flow?.rawTotalPulses, 450)
})

test('raw contract is atomic and rejects malformed or unsafe counters', () => {
  for (const fields of [ { rawTotalPulses: 3 }, { counterEpoch: 'boot' }, { pulsesPerLiter: 450 },
    { rawTotalPulses: -1, counterEpoch: 'boot', pulsesPerLiter: 450 },
    { rawTotalPulses: 0.1, counterEpoch: 'boot', pulsesPerLiter: 450 },
    { rawTotalPulses: Number.MAX_SAFE_INTEGER + 1, counterEpoch: 'boot', pulsesPerLiter: 450 },
    { rawTotalPulses: 0, counterEpoch: '', pulsesPerLiter: 450 },
    { rawTotalPulses: 0, counterEpoch: 'boot', pulsesPerLiter: 0 } ]) {
    assert.equal(normalizeTelemetry(payload(fields)).ok, false, JSON.stringify(fields))
  }
  assert.equal(normalizeTelemetry(payload({})).ok, true)
})
