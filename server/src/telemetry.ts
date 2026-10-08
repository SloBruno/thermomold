import type { PumpState } from './pumps.js'

export const K_TYPE_MIN_C = -200
export const K_TYPE_MAX_C = 1350

export interface ThermocoupleReading {
  id: 'max6675-1' | 'max6675-2'
  rawTemperatureC?: number
  temperatureC: number
}

export interface LevelReading {
  sensor: 'AJ-SR04M'
  distanceMm: number
}

export interface FlowReading {
  sensor: 'ZJ-S201'
  litersPerMinute: number
  totalLiters: number
}

export interface MultiSensorReadings {
  thermocouples: [ThermocoupleReading, ThermocoupleReading]
  level?: LevelReading
  flow?: FlowReading
}

export interface TelemetrySample {
  deviceId: string
  temperatureC: number
  rawTemperatureC?: number
  calibrationRevision?: number
  observedAt: string
  sensor: 'MAX6675'
  sensors?: MultiSensorReadings
  pumps?: PumpState
  receivedAt: string
}

export type TelemetryStatus =
  | { connected: false; status: 'offline'; stale: true; sample: null }
  | { connected: true; status: 'online' | 'stale'; stale: boolean; sample: TelemetrySample }

type TelemetryInput = {
  deviceId?: unknown
  temperatureC?: unknown
  rawTemperatureC?: unknown
  calibrationRevision?: unknown
  observedAt?: unknown
  sensor?: unknown
  sensors?: unknown
  pumps?: unknown
}

type NormalizedTelemetry = Omit<TelemetrySample, 'receivedAt'>

function normalizeSensors(value: unknown): { ok: true; value: MultiSensorReadings } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null) return { ok: false, error: 'sensors inválido' }
  const sensors = value as { thermocouples?: unknown; level?: unknown; flow?: unknown }
  if (!Array.isArray(sensors.thermocouples) || sensors.thermocouples.length !== 2) {
    return { ok: false, error: 'sensors.thermocouples deve conter os dois MAX6675' }
  }

  const readings = sensors.thermocouples.map((reading, index) => {
    if (typeof reading !== 'object' || reading === null) return null
    const item = reading as { id?: unknown; rawTemperatureC?: unknown; temperatureC?: unknown }
    const expectedId = `max6675-${index + 1}`
    if (item.id !== expectedId || typeof item.temperatureC !== 'number' || !Number.isFinite(item.temperatureC)
      || item.temperatureC < K_TYPE_MIN_C || item.temperatureC > K_TYPE_MAX_C) return null
    if (item.rawTemperatureC !== undefined && (typeof item.rawTemperatureC !== 'number'
      || !Number.isFinite(item.rawTemperatureC) || item.rawTemperatureC < K_TYPE_MIN_C || item.rawTemperatureC > K_TYPE_MAX_C)) return null
    return {
      id: expectedId as ThermocoupleReading['id'],
      ...(item.rawTemperatureC === undefined ? {} : { rawTemperatureC: item.rawTemperatureC }),
      temperatureC: item.temperatureC,
    }
  })
  if (readings.some(reading => reading === null)) return { ok: false, error: 'leitura MAX6675 inválida' }

  let level: LevelReading | undefined
  if (sensors.level !== undefined) {
    if (typeof sensors.level !== 'object' || sensors.level === null) return { ok: false, error: 'sensors.level inválido' }
    const item = sensors.level as { sensor?: unknown; distanceMm?: unknown }
    if (item.sensor !== 'AJ-SR04M' || typeof item.distanceMm !== 'number' || !Number.isFinite(item.distanceMm)
      || item.distanceMm <= 0) return { ok: false, error: 'leitura AJ-SR04M inválida' }
    level = { sensor: 'AJ-SR04M', distanceMm: item.distanceMm }
  }

  let flow: FlowReading | undefined
  if (sensors.flow !== undefined) {
    const item = sensors.flow as { sensor?: unknown; litersPerMinute?: unknown; totalLiters?: unknown } | null
    const isValidAmount = (amount: unknown): amount is number =>
      typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
    if (typeof item !== 'object' || item === null || item.sensor !== 'ZJ-S201'
      || !isValidAmount(item.litersPerMinute) || !isValidAmount(item.totalLiters)) {
      return { ok: false, error: 'leitura ZJ-S201 inválida' }
    }
    flow = { sensor: 'ZJ-S201', litersPerMinute: item.litersPerMinute, totalLiters: item.totalLiters }
  }

  return {
    ok: true,
    value: {
      thermocouples: readings as [ThermocoupleReading, ThermocoupleReading],
      ...(level ? { level } : {}),
      ...(flow ? { flow } : {}),
    },
  }
}

function normalizePumps(value: unknown): { ok: true; value: PumpState } | { ok: false; error: string } {
  const pumps = value as { pump1?: unknown; pump2?: unknown } | null
  if (typeof pumps !== 'object' || pumps === null
    || typeof pumps.pump1 !== 'boolean' || typeof pumps.pump2 !== 'boolean') {
    return { ok: false, error: 'pumps deve informar pump1 e pump2 como true ou false' }
  }
  return { ok: true, value: { pump1: pumps.pump1, pump2: pumps.pump2 } }
}

export function normalizeTelemetry(payload: TelemetryInput):
  | { ok: true; value: NormalizedTelemetry }
  | { ok: false; error: string } {
  const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(deviceId)) {
    return { ok: false, error: 'deviceId inválido' }
  }

  if (typeof payload.temperatureC !== 'number' || !Number.isFinite(payload.temperatureC)
    || payload.temperatureC < K_TYPE_MIN_C || payload.temperatureC > K_TYPE_MAX_C) {
    return { ok: false, error: 'temperatureC deve ser um número finito entre -200 e 1350' }
  }

  if (payload.rawTemperatureC !== undefined && (typeof payload.rawTemperatureC !== 'number'
    || !Number.isFinite(payload.rawTemperatureC) || payload.rawTemperatureC < K_TYPE_MIN_C || payload.rawTemperatureC > K_TYPE_MAX_C)) {
    return { ok: false, error: 'rawTemperatureC deve ser um número finito entre -200 e 1350' }
  }
  if (payload.calibrationRevision !== undefined && (!Number.isInteger(payload.calibrationRevision) || (payload.calibrationRevision as number) < 0)) {
    return { ok: false, error: 'calibrationRevision inválida' }
  }

  if (payload.sensor !== undefined && payload.sensor !== 'MAX6675') {
    return { ok: false, error: 'sensor deve ser MAX6675' }
  }

  if (payload.observedAt !== undefined && (typeof payload.observedAt !== 'string' || Number.isNaN(Date.parse(payload.observedAt)))) {
    return { ok: false, error: 'observedAt deve ser um timestamp ISO-8601 válido' }
  }

  const sensors = payload.sensors === undefined ? undefined : normalizeSensors(payload.sensors)
  if (sensors && !sensors.ok) return sensors
  if (sensors && sensors.value.thermocouples[0].temperatureC !== payload.temperatureC) {
    return { ok: false, error: 'temperatureC deve corresponder ao max6675-1' }
  }

  const pumps = payload.pumps === undefined ? undefined : normalizePumps(payload.pumps)
  if (pumps && !pumps.ok) return pumps

  return {
    ok: true,
    value: {
      deviceId,
      temperatureC: payload.temperatureC,
      ...(payload.rawTemperatureC === undefined ? {} : { rawTemperatureC: payload.rawTemperatureC }),
      ...(payload.calibrationRevision === undefined ? {} : { calibrationRevision: payload.calibrationRevision as number }),
      observedAt: payload.observedAt ?? new Date().toISOString(),
      sensor: 'MAX6675',
      ...(sensors ? { sensors: sensors.value } : {}),
      ...(pumps ? { pumps: pumps.value } : {}),
    },
  }
}

export function createTelemetryStore(staleAfterMs: number) {
  let latestSample: TelemetrySample | null = null

  function save(value: NormalizedTelemetry, receivedAt = new Date().toISOString()): TelemetrySample {
    latestSample = { ...value, receivedAt }
    return latestSample
  }

  function getStatus(now = Date.now()): TelemetryStatus {
    if (!latestSample) return { connected: false, status: 'offline', stale: true, sample: null }

    const stale = now - Date.parse(latestSample.observedAt) > staleAfterMs
    return {
      connected: true,
      status: stale ? 'stale' : 'online',
      stale,
      sample: latestSample,
    }
  }

  return { save, getStatus }
}
