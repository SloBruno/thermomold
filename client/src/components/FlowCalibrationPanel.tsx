import { useEffect, useRef, useState } from 'react'
import type { FlowCalibrationState } from '../../../shared/flow-calibration'

const base = import.meta.env.VITE_SOCKET_URL || ''
const active = (s: FlowCalibrationState | null) => s?.phase === 'collecting' || s?.phase === 'stopping'
async function request(path = '', body?: object): Promise<FlowCalibrationState> {
  const response = await fetch(`${base}/api/flow-calibration${path}`, {
    method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(3000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

export default function FlowCalibrationPanel() {
  const [state, setState] = useState<FlowCalibrationState | null>(null)
  const [reference, setReference] = useState('500')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const owner = useRef<string | null>(null)
  const cancelled = useRef(false)
  const mounted = useRef(true)

  async function emergencyOff() {
    owner.current = null
    try { await request('/abort', {}) }
    catch {
      // A failed start may still have reached the backend. OFF is safe to retry.
      try {
        const response = await fetch(`${base}/api/pumps`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pump1: false, pump2: false }), signal: AbortSignal.timeout(3000) })
        if (!response.ok) throw new Error('OFF recusado')
      } catch { if (mounted.current) setError('Sem confirmação do comando OFF. Desligue fisicamente as bombas; verifique a conexão.') }
    }
  }

  useEffect(() => {
    mounted.current = true
    let inFlight = false
    const refresh = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const data = owner.current ? await request('/heartbeat', { id: owner.current }) : await request()
        if (mounted.current) setState(data)
        if (!active(data)) owner.current = null
      } catch (cause) {
        if (mounted.current) setError(`Falha de comunicação: ${(cause as Error).message}. Verifique as bombas.`)
        if (owner.current) await emergencyOff()
      } finally { inFlight = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 1000)
    const leave = () => {
      if (!owner.current) return
      owner.current = null
      void fetch(`${base}/api/flow-calibration/abort`, { method: 'POST', keepalive: true,
        headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
    }
    const offline = () => { if (owner.current) { cancelled.current = true; setError('Rede desconectada. Coleta cancelada; confirme bombas OFF.'); void emergencyOff() } }
    window.addEventListener('pagehide', leave)
    window.addEventListener('offline', offline)
    return () => {
      mounted.current = false
      cancelled.current = true
      window.clearInterval(timer)
      window.removeEventListener('pagehide', leave)
      window.removeEventListener('offline', offline)
      leave()
    }
  }, [])

  async function start() {
    setBusy(true); setError(''); cancelled.current = false
    try {
      const data = await request('/start', { referenceMl: Number(reference) })
      if (cancelled.current || !mounted.current) { await emergencyOff(); return }
      owner.current = data.id ?? null
      setState(data)
    } catch (cause) {
      setError(`Não foi possível iniciar: ${(cause as Error).message}. Comando OFF solicitado.`)
      await emergencyOff()
    } finally { if (mounted.current) setBusy(false) }
  }
  async function stop() {
    cancelled.current = true
    setError('')
    try { const data = await request('/stop', {}); if (mounted.current) setState(data) }
    catch { setError('Falha ao parar pela rede. Comando OFF solicitado; confira as bombas.'); await emergencyOff() }
  }
  const labels = { idle: 'Pronto', collecting: 'Coletando', stopping: 'Aguardando leitura final com comando OFF', complete: 'Coleta concluída', failed: 'Coleta inválida' }
  return <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
    <h3 className="text-lg font-bold">Calibração de vazão por volume</h3>
    <p className="text-sm text-neutral-600">Prepare o recipiente, confirme o circuito seguro e pare ao atingir o volume conhecido. Iniciar envia comando para ligar as duas bombas.</p>
    <label className="block text-sm font-medium">Volume de referência (mL)
      <input aria-label="Volume de referência (mL)" type="number" min="0.1" max="1000000" step="any" value={reference}
        disabled={active(state) || busy} onChange={event => setReference(event.target.value)} className="ml-3 w-28 rounded border p-2" />
    </label>
    <div className="flex flex-wrap gap-3">
      <button className="rounded bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-40"
        disabled={!state || active(state) || busy || !Number.isFinite(Number(reference)) || Number(reference) <= 0}
        onClick={() => { void start() }}>Iniciar — ligar as duas bombas</button>
      <button className="rounded bg-red-700 px-4 py-2 font-bold text-white" onClick={() => { void stop() }}>Parar — desligar as duas bombas</button>
    </div>
    <p className="font-medium" aria-live="polite">{state ? labels[state.phase] : 'Consultando…'}</p>
    {(error || state?.error) && <p role="alert" className="text-sm text-red-800">{error || state?.error}</p>}
    {state && <div className="text-sm tabular-nums">
      <p>Tempo entre comandos: {((state.elapsedMs ?? 0) / 1000).toFixed(1)} s · Amostras: {state.sampleCount}</p>
      <p>Vazão recebida: {state.latestFlowLpm?.toFixed(2) ?? '—'} L/min · Referência da coleta: {state.referenceMl} mL</p>
      {state.measuredMl !== undefined && <p>Volume medido: {state.measuredMl.toFixed(2)} mL · Diferença: {(state.measuredMl - state.referenceMl).toFixed(2)} mL</p>}
      {state.pulses !== undefined && <p>Pulsos brutos: {state.pulses}</p>}
      {state.proposedFactor !== undefined && <p className="font-bold">Fator proposto: {state.proposedFactor.toFixed(6)} × · Novo coeficiente: {state.proposedPulsesPerLiter?.toFixed(3)} pulsos/L</p>}
      {state.baselineObservedAt && <p className="text-xs">Janela de telemetria: {state.baselineObservedAt} → {state.finalObservedAt ?? 'aguardando'}</p>}
    </div>}
    {state?.source === 'filtered-total' && <p className="text-sm text-amber-800">Sem contador bruto remoto: volume é somente a diferença do total filtrado; pode omitir pulsos. Fator de calibração indisponível até integração do firmware.</p>}
    <p className="text-xs text-neutral-500">Nenhum fator é aplicado. Aplicação persistente depende de integração do firmware e confirmação futura do operador. Volume usa contadores entre amostras, nunca integração de L/min. A janela pode incluir atraso da telemetria e fluxo residual.</p>
    <p className="text-xs text-amber-800">ON/OFF são comandos lógicos, não confirmação dos contatos. Falha de rede cancela a coleta e tenta OFF; o servidor expira a coleta sem renovação em 5 s (máximo 120 s). Não substitui parada física nem intertravamento. Aguarde a leitura final antes de repetir.</p>
  </section>
}
