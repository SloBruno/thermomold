import { useEffect, useState } from 'react'
import type { TelemetryStatus } from 'shared/types'
const base = import.meta.env.VITE_SOCKET_URL || ''
type Control = { mode: 'manual' | 'automatic'; session: string; revision: number; deviceSession: string }
export default function FillingControl() {
  const [control,setControl]=useState<Control|null>(null)
  const [actual,setActual]=useState<string>('não confirmado')
  const [error,setError]=useState('')
  const [pending,setPending]=useState(false)
  useEffect(()=> {
    let live=true
    async function load() {
      try {
        const [response,telemetry]=await Promise.all([fetch(`${base}/api/filling`),fetch(`${base}/api/telemetry`)])
        if (!response.ok || !telemetry.ok) throw new Error()
        const c=await response.json() as Control
        const t=await telemetry.json() as TelemetryStatus
        if (live) {
          setControl(c)
          setActual(t.status==='online' && t.sample?.control ? (t.sample.control.mode==='automatic'?'Automático':'Manual') : 'não confirmado')
        }
      } catch { if(live) {setControl(null);setActual('não confirmado');setError('Falha ao consultar enchimento.')} }
    }
    void load(); const timer=window.setInterval(()=>void load(),1000)
    return ()=>{live=false;window.clearInterval(timer)}
  },[])
  async function command(mode:'manual'|'automatic') {
    setPending(true)
    try {
      const response=await fetch(`${base}/api/filling`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,...(mode==='automatic'?{session:control?.session,revision:control?.revision}:{})})})
      if(!response.ok) throw new Error()
      setControl(await response.json() as Control);setError('')
    } catch {setError('Comando não confirmado. Atualize o estado e tente novamente.')} finally {setPending(false)}
  }
  return <section className="rounded-xl border border-neutral-300 bg-white p-4 space-y-2 text-neutral-900" aria-label="Enchimento do tanque real">
    <h3 className="font-bold">Enchimento do tanque real</h3>
    <p>Solicitado: {control?.mode==='automatic'?'Automático':'Manual'} · ESP32: {actual}</p>
    <div className="flex gap-2">
      <button type="button" className="rounded bg-neutral-800 px-3 py-2 text-white" onClick={()=>void command('manual')}>Manual / Parar tudo</button>
      <button type="button" className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-40" disabled={pending||!control?.deviceSession||control.mode==='automatic'} onClick={()=>void command('automatic')}>Automático</button>
    </div>
    <p className="text-sm">Decisão local no ESP32: ≤75% duas bombas; 75–95% apenas B1; ≥95% desligadas. Cada faixa deve persistir por 2 s. Manual/Parar desliga ambas e cancela a coleta.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </section>
}
