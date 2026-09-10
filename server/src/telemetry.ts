export const K_TYPE_MIN_C = -200
export const K_TYPE_MAX_C = 1350

export interface TelemetrySample {
  deviceId: string
  temperatureC: number
  observedAt: string
  sensor: 'MAX6675'
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
}

type NormalizedTelemetry = Omit<TelemetrySample, 'receivedAt'>

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

  return {
    ok: true,
    value: {
      deviceId,
      temperatureC: payload.temperatureC,
      observedAt: payload.observedAt ?? new Date().toISOString(),
      sensor: 'MAX6675',
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
