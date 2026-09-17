export const K_TYPE_MIN_C = -200
export const K_TYPE_MAX_C = 1350

export interface ThermocoupleReading {
  id: 'max6675-1' | 'max6675-2'
  temperatureC: number
}

export interface LevelReading {
  sensor: 'AJ-SR04M'
  distanceMm: number
}

export interface MultiSensorReadings {
  thermocouples: [ThermocoupleReading, ThermocoupleReading]
  level: LevelReading
}

export interface TelemetrySample {
  deviceId: string
  temperatureC: number
  observedAt: string
  sensor: 'MAX6675'
  sensors?: MultiSensorReadings
  receivedAt: string
}

export type TelemetryStatus =
  | { connected: false; status: 'offline'; stale: true; sample: null }
  | { connected: true; status: 'online' | 'stale'; stale: boolean; sample: TelemetrySample }

type TelemetryInput = {
  deviceId?: unknown
  temperatureC?: unknown
  observedAt?: unknown
  sensor?: unknown
  sensors?: unknown
}

type NormalizedTelemetry = Omit<TelemetrySample, 'receivedAt'>

function normalizeSensors(value: unknown): { ok: true; value: MultiSensorReadings } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null) return { ok: false, error: 'sensors inválido' }
  const sensors = value as { thermocouples?: unknown; level?: unknown }
  if (!Array.isArray(sensors.thermocouples) || sensors.thermocouples.length !== 2) {
    return { ok: false, error: 'sensors.thermocouples deve conter os dois MAX6675' }
  }

  const readings = sensors.thermocouples.map((reading, index) => {
    if (typeof reading !== 'object' || reading === null) return null
    const item = reading as { id?: unknown; temperatureC?: unknown }
    const expectedId = `max6675-${index + 1}`
    if (item.id !== expectedId || typeof item.temperatureC !== 'number' || !Number.isFinite(item.temperatureC)
      || item.temperatureC < K_TYPE_MIN_C || item.temperatureC > K_TYPE_MAX_C) return null
    return { id: expectedId as ThermocoupleReading['id'], temperatureC: item.temperatureC }
  })
  if (readings.some(reading => reading === null)) return { ok: false, error: 'leitura MAX6675 inválida' }

  if (typeof sensors.level !== 'object' || sensors.level === null) return { ok: false, error: 'sensors.level inválido' }
  const level = sensors.level as { sensor?: unknown; distanceMm?: unknown }
  if (level.sensor !== 'AJ-SR04M' || typeof level.distanceMm !== 'number' || !Number.isFinite(level.distanceMm)
    || level.distanceMm <= 0) return { ok: false, error: 'leitura AJ-SR04M inválida' }

  return {
    ok: true,
    value: {
      thermocouples: readings as [ThermocoupleReading, ThermocoupleReading],
      level: { sensor: 'AJ-SR04M', distanceMm: level.distanceMm },
    },
  }
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

  return {
    ok: true,
    value: {
      deviceId,
      temperatureC: payload.temperatureC,
      observedAt: payload.observedAt ?? new Date().toISOString(),
      sensor: 'MAX6675',
      ...(sensors ? { sensors: sensors.value } : {}),
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
