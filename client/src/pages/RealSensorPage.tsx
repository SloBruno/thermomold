import { useCallback, useEffect, useState } from 'react'
import socket from '../lib/socket'

type ThermocoupleReading = {
  id: 'max6675-1' | 'max6675-2'
  temperatureC: number
}

type LevelReading = {
  sensor: 'AJ-SR04M'
  distanceMm: number
}

type TelemetrySample = {
  deviceId: string
  temperatureC: number
  observedAt: string
  sensor: 'MAX6675'
  sensors?: {
    thermocouples: [ThermocoupleReading, ThermocoupleReading]
    level: LevelReading
  }
  receivedAt: string
}

type TelemetryStatus =
  | { connected: false; status: 'offline'; stale: true; sample: null }
  | { connected: true; status: 'online' | 'stale'; stale: boolean; sample: TelemetrySample }

const apiBaseUrl = import.meta.env.VITE_SOCKET_URL || ''

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestamp))
}

export default function RealSensorPage() {
  const [telemetry, setTelemetry] = useState<TelemetryStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadTelemetry = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/telemetry`)
      if (!response.ok) throw new Error(`Resposta ${response.status}`)
      setTelemetry(await response.json() as TelemetryStatus)
      setError(null)
    } catch {
      setError('Não foi possível consultar o sensor real.')
    }
  }, [])

  useEffect(() => {
    void loadTelemetry()
    const refresh = window.setInterval(() => { void loadTelemetry() }, 500)
    const handleTelemetry = (payload: TelemetryStatus) => {
      setTelemetry(payload)
      setError(null)
    }
    socket.on('telemetry:data', handleTelemetry)

    return () => {
      window.clearInterval(refresh)
      socket.off('telemetry:data', handleTelemetry)
    }
  }, [loadTelemetry])

  const sample = telemetry?.sample
  const statusLabel = error
    ? 'Erro de conexão'
    : telemetry?.status === 'online'
      ? 'Conectado'
      : telemetry?.status === 'stale'
        ? 'Dados desatualizados'
        : 'Offline'
  const statusClasses = error || telemetry?.status === 'offline'
    ? 'border-red-200 bg-red-50 text-red-800'
    : telemetry?.status === 'stale'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-green-200 bg-green-50 text-green-800'

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-white p-6">
      <section className="mx-auto max-w-2xl space-y-5">
        <header className="space-y-1">
          <h2 className="text-2xl font-bold text-neutral-900">Sensor Real</h2>
          <p className="text-sm text-neutral-500">Leitura recebida do ESP32 via Wi-Fi.</p>
        </header>

        <div className={`rounded-xl border p-4 text-sm font-bold ${statusClasses}`}>
          Status da conexão: {statusLabel}
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">{error}</div>
        ) : !sample ? (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5 text-neutral-600">
            Nenhuma leitura real foi recebida ainda.
          </div>
        ) : (
          <article className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm font-medium text-neutral-500">MAX6675 #1</p>
                <p className="text-3xl font-bold tabular-nums text-neutral-900">
                  {(sample.sensors?.thermocouples[0].temperatureC ?? sample.temperatureC).toFixed(2)} °C
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500">MAX6675 #2</p>
                <p className="text-3xl font-bold tabular-nums text-neutral-900">
                  {sample.sensors?.thermocouples?.[1]?.temperatureC?.toFixed(2) ?? '—'}
                  {sample.sensors?.thermocouples?.[1]?.temperatureC !== undefined ? ' °C' : ''}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500">Nível (AJ-SR04M)</p>
                <p className="text-3xl font-bold tabular-nums text-neutral-900">
                  {sample.sensors?.level.distanceMm ?? '—'} mm
                </p>
              </div>
            </div>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-neutral-500">Sensor</dt>
                <dd className="mt-1 font-bold text-neutral-900">{sample.sensor}</dd>
              </div>
              <div>
                <dt className="font-medium text-neutral-500">Dispositivo</dt>
                <dd className="mt-1 font-bold text-neutral-900">{sample.deviceId}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-medium text-neutral-500">Horário da leitura</dt>
                <dd className="mt-1 font-bold text-neutral-900">{formatTimestamp(sample.observedAt)}</dd>
              </div>
            </dl>
          </article>
        )}
      </section>
    </div>
  )
}
