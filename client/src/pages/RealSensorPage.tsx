import { useCallback, useEffect, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import socket from '../lib/socket'

type ThermocoupleReading = {
  id: 'max6675-1' | 'max6675-2'
  temperatureC: number
}

type LevelReading = {
  sensor: 'AJ-SR04M'
  distanceMm: number
}

type FlowReading = {
  sensor: 'ZJ-S201'
  litersPerMinute: number
  totalLiters: number
}

type TelemetrySample = {
  deviceId: string
  temperatureC: number
  observedAt: string
  sensor: 'MAX6675'
  sensors?: {
    thermocouples: [ThermocoupleReading, ThermocoupleReading]
    level?: LevelReading
    flow?: FlowReading
  }
  pumps?: { pump1: boolean; pump2: boolean }
  receivedAt: string
}

type TelemetryStatus =
  | { connected: false; status: 'offline'; stale: true; sample: null }
  | { connected: true; status: 'online' | 'stale'; stale: boolean; sample: TelemetrySample }

type ChartPoint = {
  observedAt: string
  time: string
  temperature1: number
  temperature2?: number
  levelMm?: number
  flowLpm?: number
}

const apiBaseUrl = import.meta.env.VITE_SOCKET_URL || ''

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestamp))
}

export default function RealSensorPage() {
  const [telemetry, setTelemetry] = useState<TelemetryStatus | null>(null)
  const [history, setHistory] = useState<ChartPoint[]>([])
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

  useEffect(() => {
    const sample = telemetry?.sample
    if (!sample) return
    setHistory(previous => {
      if (previous.length > 0 && previous[previous.length - 1].observedAt === sample.observedAt) return previous
      const temperatures = sample.sensors?.thermocouples
      const point: ChartPoint = {
        observedAt: sample.observedAt,
        time: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(sample.observedAt)),
        temperature1: temperatures?.[0]?.temperatureC ?? sample.temperatureC,
        temperature2: temperatures?.[1]?.temperatureC,
        levelMm: sample.sensors?.level?.distanceMm,
        flowLpm: sample.sensors?.flow?.litersPerMinute,
      }
      return [...previous, point].slice(-1200)
    })
  }, [telemetry?.sample?.observedAt])

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
                  {sample.sensors?.level?.distanceMm ?? '—'} mm
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500">Vazão (ZJ-S201)</p>
                <p className="text-3xl font-bold tabular-nums text-neutral-900">
                  {sample.sensors?.flow ? `${sample.sensors.flow.litersPerMinute.toFixed(2)} L/min` : '—'}
                </p>
                {sample.sensors?.flow && (
                  <p className="text-xs text-neutral-500">Total: {sample.sensors.flow.totalLiters.toFixed(2)} L</p>
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500">Bomba 1</p>
                <p className="text-3xl font-bold text-neutral-900">
                  {sample.pumps === undefined ? '—' : sample.pumps.pump1 ? 'Ligada' : 'Desligada'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500">Bomba 2</p>
                <p className="text-3xl font-bold text-neutral-900">
                  {sample.pumps === undefined ? '—' : sample.pumps.pump2 ? 'Ligada' : 'Desligada'}
                </p>
              </div>
            </div>
            <section className="space-y-4 border-t border-neutral-100 pt-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-lg font-bold text-neutral-900">Gráficos ao vivo</h3>
                <p className="text-xs text-neutral-500">{history.length} pontos · apaga ao fechar a página</p>
              </div>
              {history.length < 2 ? (
                <p className="rounded-lg bg-neutral-50 p-4 text-sm text-neutral-500">Aguardando mais uma leitura para desenhar os gráficos.</p>
              ) : (
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="h-64 rounded-lg border border-neutral-200 p-3">
                    <p className="mb-2 text-sm font-bold text-neutral-700">Temperaturas</p>
                    <ResponsiveContainer width="100%" height="90%">
                      <LineChart data={history}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="time" minTickGap={45} /><YAxis unit=" °C" /><Tooltip /><Legend /><Line type="monotone" dataKey="temperature1" name="MAX6675 #1" stroke="#dc2626" dot={false} /><Line type="monotone" dataKey="temperature2" name="MAX6675 #2" stroke="#2563eb" dot={false} connectNulls /></LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="h-64 rounded-lg border border-neutral-200 p-3">
                    <p className="mb-2 text-sm font-bold text-neutral-700">Nível e vazão</p>
                    <ResponsiveContainer width="100%" height="90%">
                      <LineChart data={history}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="time" minTickGap={45} /><YAxis yAxisId="level" unit=" mm" /><YAxis yAxisId="flow" orientation="right" unit=" L/m" /><Tooltip /><Legend /><Line yAxisId="level" type="monotone" dataKey="levelMm" name="Nível" stroke="#7c3aed" dot={false} connectNulls /><Line yAxisId="flow" type="monotone" dataKey="flowLpm" name="Vazão" stroke="#059669" dot={false} connectNulls /></LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </section>
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
