import { useEffect, useState, type FormEvent } from 'react'

type SensorId = 'max6675-1' | 'max6675-2'
type Point = { rawC: number; referenceC: number }
type SensorCalibration = { low: Point; high: Point }
type Calibration = { revision: number; sensors: Record<SensorId, SensorCalibration> }
type Thermocouple = { rawTemperatureC?: number; temperatureC: number }
type Telemetry = { sample?: { sensors?: { thermocouples?: Thermocouple[] } } }
type Stage = 'cold' | 'hot'
const ids: SensorId[] = ['max6675-1', 'max6675-2']
const apiBaseUrl = import.meta.env.VITE_SOCKET_URL || ''
const initial = (): Calibration => ({ revision: 0, sensors: { 'max6675-1': { low: { rawC: 0, referenceC: 0 }, high: { rawC: 0, referenceC: 40 } }, 'max6675-2': { low: { rawC: 0, referenceC: 0 }, high: { rawC: 0, referenceC: 40 } } } })

export default function CalibrationPage() {
  const [calibration, setCalibration] = useState<Calibration>(initial)
  const [readings, setReadings] = useState<Partial<Record<SensorId, number>>>({})
  const [captured, setCaptured] = useState<Partial<Record<Stage, boolean>>>({})
  const [status, setStatus] = useState('Aguardando leituras dos dois termopares…')

  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const [c, t] = await Promise.all([fetch(`${apiBaseUrl}/api/calibration`), fetch(`${apiBaseUrl}/api/telemetry`)])
        if (!c.ok || !t.ok) throw new Error()
        const next = await c.json() as Calibration
        const telemetry = await t.json() as Telemetry
        const values: Partial<Record<SensorId, number>> = {}
        telemetry.sample?.sensors?.thermocouples?.forEach((sensor, index) => { const value = sensor.rawTemperatureC ?? sensor.temperatureC; if (Number.isFinite(value) && ids[index]) values[ids[index]] = value })
        if (!active) return
        setReadings(values)
        setCalibration(current => current.revision === 0 && !captured.cold && !captured.hot ? next : current)
        setStatus(ids.every(id => Number.isFinite(values[id])) ? 'Leituras ao vivo prontas.' : 'Aguardando os dois termopares ficarem online.')
      } catch { if (active) setStatus('Não foi possível buscar as leituras atuais.') }
    }
    void refresh(); const timer = window.setInterval(() => { void refresh() }, 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [captured.cold, captured.hot])

  function setReference(stage: Stage, raw: string) {
    const point = stage === 'cold' ? 'low' : 'high'
    setCalibration(current => ({ ...current, sensors: Object.fromEntries(ids.map(id => [id, { ...current.sensors[id], [point]: { ...current.sensors[id][point], referenceC: Number(raw) } }])) as Calibration['sensors'] }))
  }
  function capture(stage: Stage) {
    if (!ids.every(id => Number.isFinite(readings[id]))) { setStatus('Espere os dois termopares aparecerem antes de capturar.'); return }
    const point = stage === 'cold' ? 'low' : 'high'
    setCalibration(current => ({ ...current, sensors: Object.fromEntries(ids.map(id => [id, { ...current.sensors[id], [point]: { ...current.sensors[id][point], rawC: readings[id] as number } }])) as Calibration['sensors'] }))
    setCaptured(current => ({ ...current, [stage]: true }))
    setStatus(stage === 'cold' ? 'Ponto frio salvo. Passe os dois termopares para o copo quente.' : 'Ponto quente salvo. Revise e aplique a calibração.')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!captured.cold || !captured.hot) { setStatus('Capture primeiro o ponto frio e depois o ponto quente.'); return }
    for (const id of ids) { const s = calibration.sensors[id]; if (![s.low.rawC, s.low.referenceC, s.high.rawC, s.high.referenceC].every(Number.isFinite) || Math.abs(s.low.rawC - s.high.rawC) < 0.1) { setStatus(`${id.toUpperCase()}: pontos inválidos ou muito próximos.`); return } }
    const response = await fetch(`${apiBaseUrl}/api/calibration`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sensors: calibration.sensors }) })
    if (!response.ok) { setStatus((await response.json() as { error?: string }).error ?? 'Calibração rejeitada.'); return }
    const saved = await response.json() as Calibration; setCalibration(saved); setStatus(`Calibração salva na revisão ${saved.revision}. O ESP32 aplicará na próxima telemetria.`)
  }
  const cold = calibration.sensors['max6675-1'].low.referenceC; const hot = calibration.sensors['max6675-1'].high.referenceC
  return <main className="min-h-[calc(100vh-4rem)] bg-white p-6"><form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
    <header><h2 className="text-2xl font-bold text-neutral-900">Calibração dos termopares</h2><p className="mt-1 text-sm text-neutral-700">Os dois termopares passam juntos pelo copo frio e, depois, pelo copo quente. O site captura as leituras atuais automaticamente.</p></header>
    <section className="rounded-xl border-2 border-sky-200 bg-sky-50 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-sky-950">1. Copo frio</h3><p className="text-sm text-sky-900">Água com bastante gelo picado. Misture e espere 5 minutos.</p></div><button type="button" onClick={() => capture('cold')} className="rounded bg-sky-700 px-4 py-2 font-bold text-white hover:bg-sky-800">Capturar ponto frio</button></div><label className="mt-4 block max-w-xs text-sm font-medium text-sky-950">Referência do copo frio (°C)<input type="number" step="0.01" value={cold} onChange={e => setReference('cold', e.target.value)} className="mt-1 w-full rounded border border-sky-300 bg-white p-2 text-neutral-900" /></label>{captured.cold && <p className="mt-3 text-sm font-medium text-emerald-800">✓ Frio: MAX6675-1 {calibration.sensors['max6675-1'].low.rawC.toFixed(2)} °C · MAX6675-2 {calibration.sensors['max6675-2'].low.rawC.toFixed(2)} °C</p>}</section>
    <section className="rounded-xl border-2 border-orange-200 bg-orange-50 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-orange-950">2. Copo quente</h3><p className="text-sm text-orange-900">Passe os dois termopares para a água quente, misture e espere 5 minutos.</p></div><button type="button" onClick={() => capture('hot')} disabled={!captured.cold} className="rounded bg-orange-700 px-4 py-2 font-bold text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:bg-neutral-400">Capturar ponto quente</button></div><label className="mt-4 block max-w-xs text-sm font-medium text-orange-950">Referência do copo quente (°C)<input type="number" step="0.01" value={hot} onChange={e => setReference('hot', e.target.value)} className="mt-1 w-full rounded border border-orange-300 bg-white p-2 text-neutral-900" /></label>{captured.hot && <p className="mt-3 text-sm font-medium text-emerald-800">✓ Quente: MAX6675-1 {calibration.sensors['max6675-1'].high.rawC.toFixed(2)} °C · MAX6675-2 {calibration.sensors['max6675-2'].high.rawC.toFixed(2)} °C</p>}</section>
    <section className="rounded-xl border border-neutral-200 bg-white p-5"><h3 className="font-bold text-neutral-900">Leituras atuais</h3><p className="mt-2 text-sm text-neutral-700">MAX6675-1: <strong>{readings['max6675-1']?.toFixed(2) ?? '—'} °C</strong> · MAX6675-2: <strong>{readings['max6675-2']?.toFixed(2) ?? '—'} °C</strong></p></section>
    <div className="flex flex-wrap items-center justify-between gap-4"><span className="text-sm font-medium text-neutral-700">Revisão atual: {calibration.revision} · {status}</span><button disabled={!captured.cold || !captured.hot} className="rounded bg-neutral-900 px-5 py-2 font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-400">Aplicar calibração no ESP32</button></div>
  </form></main>
}
