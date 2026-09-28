import { useCallback, useEffect, useState } from 'react'
import socket from '../lib/socket'

type PumpId = 'pump1' | 'pump2'
type PumpState = Record<PumpId, boolean>

type TelemetryStatus = {
  connected: boolean
  status: 'offline' | 'online' | 'stale'
  sample: { pumps?: PumpState; observedAt: string } | null
}

const apiBaseUrl = import.meta.env.VITE_SOCKET_URL || ''

const PUMPS: { id: PumpId; name: string; relay: string }[] = [
  { id: 'pump1', name: 'Bomba 1', relay: 'Relé K1 · D19' },
  { id: 'pump2', name: 'Bomba 2', relay: 'Relé K2 · D33' },
]

export default function PumpControlPage() {
  const [desired, setDesired] = useState<PumpState | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetryStatus | null>(null)
  const [pending, setPending] = useState<PumpId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [pumpsResponse, telemetryResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/pumps`),
        fetch(`${apiBaseUrl}/api/telemetry`),
      ])
      if (!pumpsResponse.ok || !telemetryResponse.ok) throw new Error('resposta inválida')
      setDesired(await pumpsResponse.json() as PumpState)
      setTelemetry(await telemetryResponse.json() as TelemetryStatus)
      setError(null)
    } catch {
      setError('Não foi possível consultar o servidor.')
    }
  }, [])

  useEffect(() => {
    void load()
    const refresh = window.setInterval(() => { void load() }, 500)
    const handlePumps = (payload: PumpState) => setDesired(payload)
    const handleTelemetry = (payload: TelemetryStatus) => setTelemetry(payload)
    socket.on('pumps:data', handlePumps)
    socket.on('telemetry:data', handleTelemetry)
    return () => {
      window.clearInterval(refresh)
      socket.off('pumps:data', handlePumps)
      socket.off('telemetry:data', handleTelemetry)
    }
  }, [load])

  async function command(id: PumpId, on: boolean) {
    setPending(id)
    try {
      const response = await fetch(`${apiBaseUrl}/api/pumps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [id]: on }),
      })
      if (!response.ok) throw new Error('comando recusado')
      setDesired(await response.json() as PumpState)
      setError(null)
    } catch {
      setError('Não foi possível enviar o comando.')
    } finally {
      setPending(null)
    }
  }

  const espOnline = telemetry?.status === 'online'
  const actual = espOnline ? telemetry?.sample?.pumps : undefined

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-white p-6">
      <section className="mx-auto max-w-2xl space-y-5">
        <header className="space-y-1">
          <h2 className="text-2xl font-bold text-neutral-900">Controle de Bombas</h2>
          <p className="text-sm text-neutral-500">
            Liga/desliga manual. O ESP32 desliga as bombas sozinho se perder o Wi-Fi ou o servidor por 3 segundos.
          </p>
        </header>

        <div className={`rounded-xl border p-4 text-sm font-bold ${espOnline
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'border-red-200 bg-red-50 text-red-800'}`}
        >
          ESP32: {espOnline ? 'Conectado' : 'Offline — comandos não serão aplicados'}
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          {PUMPS.map(pump => {
            const wanted = desired?.[pump.id] ?? false
            const confirmed = actual?.[pump.id]
            const waiting = confirmed !== undefined && confirmed !== wanted
            return (
              <article key={pump.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-neutral-900">{pump.name}</h3>
                  <p className="text-xs text-neutral-500">{pump.relay}</p>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-neutral-500">Comando</dt>
                    <dd className="font-bold text-neutral-900">{wanted ? 'Ligada' : 'Desligada'}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Estado no ESP32</dt>
                    <dd className={`font-bold ${confirmed === undefined ? 'text-neutral-400' : confirmed ? 'text-green-700' : 'text-neutral-900'}`}>
                      {confirmed === undefined ? '—' : confirmed ? 'Ligada' : 'Desligada'}
                      {waiting ? ' (aguardando)' : ''}
                    </dd>
                  </div>
                </dl>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pending === pump.id || wanted}
                    onClick={() => { void command(pump.id, true) }}
                    className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    Ligar
                  </button>
                  <button
                    type="button"
                    disabled={pending === pump.id || !wanted}
                    onClick={() => { void command(pump.id, false) }}
                    className="flex-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    Desligar
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
