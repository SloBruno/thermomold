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

test('rejects a multi-sensor payload whose legacy temperature differs from thermocouple one', () => {
  assert.deepEqual(
    normalizeTelemetry({
      deviceId: 'esp32-molde-01',
      temperatureC: 84.25,
      sensor: 'MAX6675',
      sensors: {
        thermocouples: [
          { id: 'max6675-1', temperatureC: 84.5 },
          { id: 'max6675-2', temperatureC: 85.5 },
        ],
        level: { sensor: 'AJ-SR04M', distanceMm: 350 },
      },
    }),
    { ok: false, error: 'temperatureC deve corresponder ao max6675-1' },
  )
})

test('accepts a live payload when the optional AJ-SR04M is unavailable', () => {
  const result = normalizeTelemetry({
    deviceId: 'esp32-molde-01',
    temperatureC: 84.25,
    sensor: 'MAX6675',
    sensors: {
      thermocouples: [
        { id: 'max6675-1', temperatureC: 84.25 },
        { id: 'max6675-2', temperatureC: 85.5 },
      ],
    },
    pumps: { pump1: false, pump2: false },
  })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.sensors?.level, undefined)
})

test('normalizes ZJ-S201 flow and the actual relay state reported by the ESP32', () => {
  const observedAt = '2026-09-10T12:30:00.000Z'
  const result = normalizeTelemetry({
    deviceId: 'esp32-molde-01',
    temperatureC: 84.25,
    observedAt,
    sensor: 'MAX6675',
    sensors: {
      thermocouples: [
        { id: 'max6675-1', temperatureC: 84.25 },
        { id: 'max6675-2', temperatureC: 85.5 },
      ],
      level: { sensor: 'AJ-SR04M', distanceMm: 350 },
      flow: { sensor: 'ZJ-S201', litersPerMinute: 2.4, totalLiters: 12.75 },
    },
    pumps: { pump1: true, pump2: false },
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value.sensors?.flow, { sensor: 'ZJ-S201', litersPerMinute: 2.4, totalLiters: 12.75 })
  assert.deepEqual(result.value.pumps, { pump1: true, pump2: false })
})

test('rejects negative flow and non-boolean relay state', () => {
  const base = {
    deviceId: 'esp32-molde-01',
    temperatureC: 84.25,
    sensor: 'MAX6675',
    sensors: {
      thermocouples: [
        { id: 'max6675-1', temperatureC: 84.25 },
        { id: 'max6675-2', temperatureC: 85.5 },
      ],
      level: { sensor: 'AJ-SR04M', distanceMm: 350 },
    },
  }

  assert.deepEqual(
    normalizeTelemetry({ ...base, sensors: { ...base.sensors, flow: { sensor: 'ZJ-S201', litersPerMinute: -1, totalLiters: 0 } } }),
    { ok: false, error: 'leitura ZJ-S201 inválida' },
  )
  assert.deepEqual(
    normalizeTelemetry({ ...base, pumps: { pump1: 'on', pump2: false } }),
    { ok: false, error: 'pumps deve informar pump1 e pump2 como true ou false' },
  )
})

test('normalizes both MAX6675 readings and the AJ-SR04M distance while preserving legacy temperatureC', () => {
  const observedAt = '2026-09-10T12:30:00.000Z'

  assert.deepEqual(
    normalizeTelemetry({
      deviceId: 'esp32-molde-01',
      temperatureC: 84.25,
      observedAt,
      sensor: 'MAX6675',
      sensors: {
        thermocouples: [
          { id: 'max6675-1', temperatureC: 84.25 },
          { id: 'max6675-2', temperatureC: 85.5 },
        ],
        level: { sensor: 'AJ-SR04M', distanceMm: 350 },
      },
    }),
    {
      ok: true,
      value: {
        deviceId: 'esp32-molde-01',
        temperatureC: 84.25,
        observedAt,
        sensor: 'MAX6675',
        sensors: {
          thermocouples: [
            { id: 'max6675-1', temperatureC: 84.25 },
            { id: 'max6675-2', temperatureC: 85.5 },
          ],
          level: { sensor: 'AJ-SR04M', distanceMm: 350 },
        },
      },
    },
  )
})

test('normalizes corrected MAX6675 values with raw readings and calibration revision', () => {
  const result = normalizeTelemetry({
    deviceId: 'esp32-molde-01',
    temperatureC: 85,
    rawTemperatureC: 84,
    calibrationRevision: 7,
    sensor: 'MAX6675',
    sensors: {
      thermocouples: [
        { id: 'max6675-1', rawTemperatureC: 84, temperatureC: 85 },
        { id: 'max6675-2', rawTemperatureC: 90, temperatureC: 89 },
      ],
    },
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.rawTemperatureC, 84)
    assert.equal(result.value.calibrationRevision, 7)
    assert.deepEqual(result.value.sensors?.thermocouples[1], { id: 'max6675-2', rawTemperatureC: 90, temperatureC: 89 })
  }
})
