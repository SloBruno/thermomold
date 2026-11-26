import { useEffect, useState } from 'react'
import type { TelemetryStatus } from '../../../shared/types'
import socket from '../lib/socket'
import { tankLevelPercent } from '../lib/tank-level'
import TemperatureAlarm from '../components/TemperatureAlarm'
import esquemaThermomold from '../assets/esquema-thermomold.jpeg'
import './supervisory.css'

type Pumps = { pump1: boolean; pump2: boolean }
type Control = { mode: 'manual' | 'automatic'; session: string; revision: number; deviceSession: string }
const base = import.meta.env.VITE_SOCKET_URL || ''
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const reading = (n: unknown, unit: string) => finite(n) ? `${n.toFixed(2)} ${unit}` : 'Indisponível'
const state = (n: unknown) => typeof n !== 'boolean' ? 'Indisponível' : n ? 'Ligada' : 'Desligada'

export default function SupervisoryPage() {
  const [telemetry, setTelemetry] = useState<TelemetryStatus | null>(null)
  const [pumps, setPumps] = useState<Pumps | null>(null)
  const [control, setControl] = useState<Control | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let live = true
    async function load() {
      try {
        const responses = await Promise.all(['/api/telemetry','/api/pumps','/api/filling'].map(path => fetch(base + path)))
        if (responses.some(r => !r.ok)) throw new Error()
        const [t,p,c] = await Promise.all(responses.map(r => r.json()))
        if (live) { setTelemetry(t); setPumps(p); setControl(c); setError('') }
      } catch { if (live) { setTelemetry(null); setPumps(null); setControl(null); setError('Falha ao consultar o servidor.') } }
    }
    void load()
    const timer = window.setInterval(() => { setNow(Date.now()); void load() }, 1000)
    const updateTelemetry = (t: TelemetryStatus) => setTelemetry(t)
    const updatePumps = (p: Pumps) => setPumps(p)
    socket.on('telemetry:data', updateTelemetry); socket.on('pumps:data', updatePumps)
    return () => { live = false; window.clearInterval(timer); socket.off('telemetry:data', updateTelemetry); socket.off('pumps:data', updatePumps) }
  }, [])
  async function send(path: string, body: object) {
    setPending(true)
    try {
      const response = await fetch(base + path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
      if (!response.ok) { const detail = await response.json().catch(() => null); throw new Error(detail?.error || 'Comando recusado.') }
      const result = await response.json()
      if (path === '/api/pumps') setPumps(result); else setControl(result)
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Comando não confirmado.') }
    finally { setPending(false) }
  }
  const sample = telemetry?.sample
  const received = sample ? Date.parse(sample.receivedAt) : NaN
  const online = telemetry?.status === 'online' && !telemetry.stale && Number.isFinite(received) && now - received <= 8000
  const status = !telemetry || telemetry.status === 'offline' ? 'Offline' : online ? 'Online' : 'Dados desatualizados'
  const t1 = online ? (sample?.sensors ? sample.sensors.thermocouples?.[0]?.temperatureC : sample?.temperatureC) : undefined
  const t2 = online ? sample?.sensors?.thermocouples?.[1]?.temperatureC : undefined
  const level = online ? tankLevelPercent(sample?.sensors?.level?.distanceMm) : undefined
  const flow = online ? sample?.sensors?.flow?.litersPerMinute : undefined
  const actual = online ? sample?.pumps : undefined
  const manual = online && control?.mode === 'manual' && sample?.control?.mode === 'manual'
  const canAuto = online && !!control?.deviceSession && !!sample?.control && control.mode === 'manual'
  return <div className="supervisory">
    <header className="super-header"><h2>Supervisório</h2><div className={`connection ${online?'online':'offline'}`}><span />{status}</div></header>
    {error && <p className="super-error" role="alert">{error}</p>}
    <div className="super-alarm"><TemperatureAlarm telemetry={online ? telemetry : null} /></div>
    <div className="super-layout"><section className="circuit" aria-label="Processo e leituras">
      <figure className="process-schematic"><img src={esquemaThermomold} alt="Esquema original do circuito ThermoMold" /></figure>
      <div className="measurements">
        <div><span>T1</span><strong>{reading(t1,'°C')}</strong></div><div><span>T2</span><strong>{reading(t2,'°C')}</strong></div>
        <div><span>ΔT</span><strong>{reading(finite(t1) && finite(t2) ? Math.abs(t1-t2) : undefined,'°C')}</strong></div>
        <div><span>Nível</span><strong>{finite(level) ? `${level.toFixed(0)} %` : 'Indisponível'}</strong></div><div><span>Vazão</span><strong>{reading(flow,'L/min')}</strong></div>
      </div>
    </section><aside className="controls"><h3>Controle das bombas</h3><p>Solicitado: {control ? control.mode === 'manual' ? 'Manual' : 'Automático' : 'Indisponível'}<br />ESP32: {online && sample?.control ? sample.control.mode === 'manual' ? 'Manual' : 'Automático' : 'Não confirmado'}</p><div className="mode-buttons"><button onClick={()=>void send('/api/filling',{mode:'manual'})}>Manual / Parar tudo</button><button disabled={pending || !canAuto} onClick={()=>void send('/api/filling',{mode:'automatic',session:control?.session,revision:control?.revision})}>Automático</button></div>
      {(['pump1','pump2'] as const).map((id,i)=><div className="pump-row" key={id}><h4>Bomba {i+1}</h4><div className="pump-states"><span>Comando <b>{state(pumps?.[id])}</b></span><span>Relatado pelo ESP32 <b>{state(actual?.[id])}</b></span></div><div className="pump-buttons"><button disabled={pending || !manual || !pumps || pumps[id]} onClick={()=>void send('/api/pumps',{[id]:true})}>Ligar B{i+1}</button><button disabled={pending} onClick={()=>void send('/api/pumps',{[id]:false})}>Desligar B{i+1}</button></div></div>)}
      <p className="control-note">Estado informado pelo ESP32; sem confirmação física.</p>
    </aside></div>
  </div>
}
