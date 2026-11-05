import { useCallback, useEffect, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import socket from '../lib/socket'
import TemperatureAlarm from '../components/TemperatureAlarm'
import FlowCalibrationPanel from '../components/FlowCalibrationPanel'
import { tankLevelPercent, TANK_EMPTY_MM, TANK_FULL_MM } from '../lib/tank-level'

import type { TelemetryStatus, TemperatureC } from '../../../shared/types'


type ChartPoint = {
  observedAt: string
  time: string
  temperature1: TemperatureC
  temperature2?: TemperatureC
  levelMm?: number
  levelPercent?: number
  flowLpm?: number
}

const apiBaseUrl = import.meta.env.VITE_SOCKET_URL || ''

function describeMax6675Status(status: number): string {
  if (status === 0x81) return 'quadro inválido ou zero ambíguo; leitura indisponível'
  if (status === 0x04) return 'termopar aberto'
  if (status === 0x80) return 'sem leitura'
  return 'falha de leitura'
}

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
        temperature1: temperatures ? temperatures[0].temperatureC : sample.temperatureC,
        temperature2: temperatures?.[1]?.temperatureC,
        levelMm: sample.sensors?.level?.distanceMm,
        levelPercent: tankLevelPercent(sample.sensors?.level?.distanceMm),
        flowLpm: sample.sensors?.flow?.litersPerMinute,
      }
      return [...previous, point].slice(-1200)
    })
  }, [telemetry?.sample?.observedAt])

  const sample = telemetry?.sample
  const levelPercent = tankLevelPercent(sample?.sensors?.level?.distanceMm)
  const max6675Warnings = (sample?.diagnostics?.max6675Status ?? [])
    .map((status, index) => ({ status, index }))
    .filter(({ status }) => status !== 0)
    .map(({ status, index }) => `MAX6675 #${index + 1}: ${describeMax6675Status(status)} (status ${status})`)
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

        <TemperatureAlarm telemetry={error ? null : telemetry} />
        <FlowCalibrationPanel />

        {!error && max6675Warnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800" role="alert">
            {max6675Warnings.map(warning => <p key={warning}>{warning}</p>)}
          </div>
        )}

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
                  {(sample.sensors ? sample.sensors.thermocouples[0].temperatureC : sample.temperatureC)?.toFixed(2) ?? 'Indisponível'}
                  {sample.temperatureC !== null ? ' °C' : ''}
                </p>
                {sample.rawTemperatureC != null && <p className="text-xs text-neutral-500">Bruta: {sample.rawTemperatureC.toFixed(2)} °C</p>}
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500">Revisão de calibração</p>
                <p className="text-3xl font-bold tabular-nums text-neutral-900">{sample.calibrationRevision ?? '—'}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500">MAX6675 #2</p>
                <p className="text-3xl font-bold tabular-nums text-neutral-900">
                  {sample.sensors?.thermocouples?.[1]?.temperatureC?.toFixed(2) ?? 'Indisponível'}
                  {sample.sensors?.thermocouples?.[1]?.temperatureC != null ? ' °C' : ''}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500">Nível (AJ-SR04M)</p>
                <p className="text-3xl font-bold tabular-nums text-neutral-900">
                  {levelPercent === undefined ? 'Indisponível' : `${levelPercent.toFixed(0)}%`}
                </p>
                <p className="text-xs text-neutral-500">{sample.sensors?.level?.distanceMm ?? '—'} mm · {TANK_EMPTY_MM} mm = 0% · {TANK_FULL_MM} mm = 100%</p>
                {levelPercent !== undefined && <progress aria-label="Nível do tanque" value={levelPercent} max={100} className="mt-2 h-3 w-full accent-violet-600" />}
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500">Vazão (ZJ-S201)</p>
                <p className="text-3xl font-bold tabular-nums text-neutral-900">
                  {sample.sensors?.flow ? `${sample.sensors.flow.litersPerMinute.toFixed(2)} L/min` : '—'}
                </p>
                {sample.sensors?.flow && (
                  <p className="text-xs text-neutral-500">Total: {sample.sensors.flow.totalLiters.toFixed(2)} L{sample.sensors.flow.pulsesPerLiter ? ` · ${sample.sensors.flow.pulsesPerLiter.toFixed(2)} pulsos/L` : ''}</p>
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
                      <LineChart data={history}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="time" minTickGap={45} /><YAxis unit=" °C" /><Tooltip /><Legend /><Line type="monotone" dataKey="temperature1" name="MAX6675 #1" stroke="#dc2626" dot={false} /><Line type="monotone" dataKey="temperature2" name="MAX6675 #2" stroke="#2563eb" dot={false} connectNulls={false} /></LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="h-64 rounded-lg border border-neutral-200 p-3">
                    <p className="mb-2 text-sm font-bold text-neutral-700">Nível e vazão</p>
                    <ResponsiveContainer width="100%" height="90%">
                      <LineChart data={history}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="time" minTickGap={45} /><YAxis yAxisId="level" unit="%" domain={[0,100]} /><YAxis yAxisId="flow" orientation="right" unit=" L/m" /><Tooltip /><Legend /><Line yAxisId="level" type="monotone" dataKey="levelPercent" name="Nível (%)" stroke="#7c3aed" dot={false} connectNulls /><Line yAxisId="flow" type="monotone" dataKey="flowLpm" name="Vazão" stroke="#059669" dot={false} connectNulls /></LineChart>
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
