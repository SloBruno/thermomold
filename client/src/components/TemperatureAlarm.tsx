import { useEffect, useRef, useState } from 'react'
import type { TelemetryStatus } from '../../../shared/types'
import { AlarmAudio } from '../lib/temperature-alarm-audio'

export default function TemperatureAlarm({ telemetry }: { telemetry: TelemetryStatus | null }) {
  const [now,setNow]=useState(Date.now())
  const [sound,setSound]=useState<'off'|'on'|'muted'|'blocked'>('off')
  const audio=useRef<AlarmAudio | null>(null)
  useEffect(()=>{
    audio.current=new AlarmAudio()
    const timer=window.setInterval(()=>setNow(Date.now()),500)
    return ()=>{window.clearInterval(timer);audio.current?.dispose();audio.current=null}
  },[])
  const sample=telemetry?.sample
  const alarm=sample?.temperatureAlarm
  const stale=!telemetry || telemetry.stale || telemetry.status!=='online' || !sample
    || !Number.isFinite(Date.parse(sample.receivedAt)) || now-Date.parse(sample.receivedAt)>15000
  const invalid=sample?.sensors?.thermocouples.some(item=>item.temperatureC===null || !Number.isFinite(item.temperatureC))
  const state=stale || invalid || !alarm ? 'unknown' : alarm.state
  const active=state==='warning' || state==='severe'
  useEffect(()=>{
    if(!active || sound!=='on'){audio.current?.stop();return}
    const play=()=>{try{audio.current?.play(state)}catch{setSound('blocked')}}
    play()
    const timer=window.setInterval(play,state==='severe'?1200:3000)
    return ()=>{window.clearInterval(timer);audio.current?.stop()}
  },[state,active,sound])
  const label=stale ? 'Alarme indisponível — dados desatualizados ou conexão indisponível'
    : !alarm ? 'Alarme não confirmado — firmware sem estado local'
    : state==='unknown' ? 'Alarme indisponível — falha dos sensores'
    : state==='severe' ? 'Grave: ΔT > 5 °C'
    : state==='warning' ? 'Atenção: ΔT > 3 °C por pelo menos 2 s'
    : state==='pending' ? 'Aguardando confirmação local de 2 s'
    : 'Normal: ΔT ≤ 3 °C'
  const color=state==='severe'?'border-red-600 bg-red-100 text-red-950'
    :state==='warning'?'border-yellow-500 bg-yellow-100 text-yellow-950'
    :state==='normal'?'border-green-400 bg-green-50 text-green-950':'border-neutral-400 bg-neutral-100 text-neutral-900'
  async function enable(){
    try{await audio.current?.enable();setSound('on')}catch{setSound('blocked')}
  }
  return <section aria-label="Alarme dos termopares reais" role="alert" className={`rounded-xl border-2 p-4 space-y-2 ${color}`}>
    <h3 className="font-bold">Termopares reais — {label}</h3>
    <p>ΔT = |T1 − T2| calibradas: {state==='unknown'?'—':`${alarm?.deltaC?.toFixed(2)} °C`}</p>
    <p className="text-sm">Decisão no ESP32; entrega pelo próximo envio de telemetria. Não controla bombas.</p>
    <div className="flex gap-3 items-center text-sm">
      {sound!=='on' && <button type="button" className="rounded border px-3 py-1" onClick={()=>void enable()}>Ativar som</button>}
      {sound==='on' && <button type="button" className="rounded border px-3 py-1" onClick={()=>{audio.current?.stop();setSound('muted')}}>Silenciar</button>}
      <span>{sound==='blocked'?'Som bloqueado — tente Ativar som':sound==='muted'?'Som silenciado; aviso visual ativo':sound==='on'?'Som ativado nesta página':'Som desativado — requer Ativar som'}</span>
    </div>
  </section>
}
