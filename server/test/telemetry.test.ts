import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTelemetry } from '../src/telemetry.ts'

test('normalizes a valid MAX6675 telemetry payload', () => {
  const observedAt = '2026-09-10T12:30:00.000Z'

  assert.deepEqual(
    normalizeTelemetry({
      deviceId: 'esp32-molde-01',
      temperatureC: 84.25,
      observedAt,
      sensor: 'MAX6675',
    }),
    {
      ok: true,
      value: {
        deviceId: 'esp32-molde-01',
        temperatureC: 84.25,
        observedAt,
        sensor: 'MAX6675',
      },
    },
  )
})

test('rejects malformed payloads and temperatures outside K-type range', () => {
  assert.deepEqual(normalizeTelemetry({ deviceId: ' ', temperatureC: 20 }), {
    ok: false,
    error: 'deviceId inválido',
  })
  assert.deepEqual(normalizeTelemetry({ deviceId: 'esp32-01', temperatureC: Number.NaN }), {
    ok: false,
    error: 'temperatureC deve ser um número finito entre -200 e 1350',
  })
  assert.deepEqual(normalizeTelemetry({ deviceId: 'esp32-01', temperatureC: 1350.01 }), {
    ok: false,
    error: 'temperatureC deve ser um número finito entre -200 e 1350',
  })
  assert.deepEqual(normalizeTelemetry({ deviceId: 'esp32-01', temperatureC: 20, observedAt: 'ontem' }), {
    ok: false,
    error: 'observedAt deve ser um timestamp ISO-8601 válido',
  })
})
