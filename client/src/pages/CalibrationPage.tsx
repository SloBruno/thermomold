import { useEffect, useState, type FormEvent } from 'react'

type Point = { rawC: number; referenceC: number }
type SensorCalibration = { low: Point; high: Point }
type Calibration = { revision: number; sensors: Record<'max6675-1' | 'max6675-2', SensorCalibration> }
type Telemetry = { sample?: { sensors?: { thermocouples?: [{ rawTemperatureC?: number; temperatureC: number }, { rawTemperatureC?: number; temperatureC: number }] } } }

const apiBaseUrl = import.meta.env.VITE_SOCKET_URL || ''
const emptySensor = (): SensorCalibration => ({ low: { rawC: 0, referenceC: 0 }, high: { rawC: 100, referenceC: 100 } })

export default function CalibrationPage() {
  const [calibration, setCalibration] = useState<Calibration>({ revision: 0, sensors: { 'max6675-1': emptySensor(), 'max6675-2': emptySensor() } })
  const [status, setStatus] = useState('Carregando calibração…')

  useEffect(() => {
    void Promise.all([
      fetch(`${apiBaseUrl}/api/calibration`).then(response => response.json() as Promise<Calibration>),
      fetch(`${apiBaseUrl}/api/telemetry`).then(response => response.json() as Promise<Telemetry>),
    ]).then(([next, telemetry]) => {
      const readings = telemetry.sample?.sensors?.thermocouples
      if (readings) {
        for (const [index, id] of (['max6675-1', 'max6675-2'] as const).entries()) {
          const raw = readings[index]?.rawTemperatureC ?? readings[index]?.temperatureC
          if (Number.isFinite(raw)) next.sensors[id].low.rawC = raw
        }
      }
      setCalibration(next)
      setStatus('Pronto para calibrar')
    }).catch(() => setStatus('Não foi possível carregar a calibração.'))
  }, [])

  function update(id: 'max6675-1' | 'max6675-2', point: 'low' | 'high', field: 'rawC' | 'referenceC', value: string) {
    setCalibration(current => ({ ...current, sensors: { ...current.sensors, [id]: { ...current.sensors[id], [point]: { ...current.sensors[id][point], [field]: Number(value) } } } }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    for (const id of ['max6675-1', 'max6675-2'] as const) {
      const sensor = calibration.sensors[id]
      if (![sensor.low.rawC, sensor.low.referenceC, sensor.high.rawC, sensor.high.referenceC].every(Number.isFinite) || sensor.low.rawC === sensor.high.rawC) {
        setStatus(`${id}: informe dois pontos válidos com raw diferente.`)
        return
      }
    }
    const response = await fetch(`${apiBaseUrl}/api/calibration`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sensors: calibration.sensors }) })
    if (!response.ok) { setStatus((await response.json() as { error?: string }).error ?? 'Calibração rejeitada.'); return }
    const saved = await response.json() as Calibration
    setCalibration(saved)
    setStatus(`Calibração salva na revisão ${saved.revision}. Aguarde a próxima telemetria do ESP32.`)
  }

  return <div className="min-h-[calc(100vh-4rem)] bg-white p-6"><form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
    <header><h2 className="text-2xl font-bold text-neutral-900">Calibração dos MAX6675</h2><p className="text-sm text-neutral-500">Use dois pontos conhecidos para cada termopar. O ESP32 aplicará a revisão recebida na próxima telemetria autenticada.</p></header>
    {(['max6675-1', 'max6675-2'] as const).map(id => <section key={id} className="rounded-xl border border-neutral-200 p-5 shadow-sm"><h3 className="font-bold">{id.toUpperCase()}</h3><div className="mt-4 grid gap-4 sm:grid-cols-2">{(['low', 'high'] as const).map(point => <fieldset key={point} className="rounded-lg bg-neutral-50 p-4"><legend className="font-medium">{point === 'low' ? 'Ponto baixo' : 'Ponto alto'}</legend><label className="mt-2 block text-sm">Leitura bruta (°C)<input type="number" step="0.01" value={calibration.sensors[id][point].rawC} onChange={event => update(id, point, 'rawC', event.target.value)} className="mt-1 w-full rounded border p-2" /></label><label className="mt-2 block text-sm">Temperatura de referência (°C)<input type="number" step="0.01" value={calibration.sensors[id][point].referenceC} onChange={event => update(id, point, 'referenceC', event.target.value)} className="mt-1 w-full rounded border p-2" /></label></fieldset>)}</div></section>)}
    <div className="flex items-center justify-between gap-4"><span className="text-sm text-neutral-600">Revisão atual: {calibration.revision} · {status}</span><button className="rounded bg-neutral-900 px-5 py-2 font-bold text-white hover:bg-neutral-700">Salvar calibração</button></div>
  </form></div>
}
