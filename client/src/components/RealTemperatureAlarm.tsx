import { useEffect, useState } from 'react'
import type { TelemetryStatus } from '../../../shared/types'
import socket from '../lib/socket'
import TemperatureAlarm from './TemperatureAlarm'
const apiBaseUrl=import.meta.env.VITE_SOCKET_URL || ''
// Dashboard alarm subscribes only to REAL telemetry, never simulator/dashboard data.
export default function RealTemperatureAlarm() {
  const [telemetry,setTelemetry]=useState<TelemetryStatus | null>(null)
  useEffect(()=>{
    let disposed=false
    const update=(value:TelemetryStatus)=>{if(!disposed)setTelemetry(value)}
    async function refresh(){
      try{
        const response=await fetch(`${apiBaseUrl}/api/telemetry`)
        if(!response.ok)throw new Error('telemetry')
        update(await response.json() as TelemetryStatus)
      }catch{if(!disposed)setTelemetry(null)}
    }
    void refresh()
    const timer=window.setInterval(()=>void refresh(),500)
    socket.on('telemetry:data',update)
    return ()=>{disposed=true;window.clearInterval(timer);socket.off('telemetry:data',update)}
  },[])
  return <TemperatureAlarm telemetry={telemetry} />
}
