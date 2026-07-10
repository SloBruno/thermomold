import { useEffect, useState } from 'react'
import socket from '../lib/socket'
import type { DashboardData, MachineData } from 'shared/types'

function SensorValue({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 space-y-1">
      <p className="text-sm font-bold text-neutral-700">{label}</p>
      <p className="text-xl font-bold text-neutral-900 tabular-nums">
        {value} <span className="text-sm font-normal text-neutral-500">{unit}</span>
      </p>
    </div>
  )
}

function SensorCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
      <h3 className="text-base font-bold text-neutral-900">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{children}</div>
    </section>
  )
}

function Sensors({ machine }: { machine: MachineData }) {
  return (
    <>
      <SensorCard title="Água de entrada no molde">
        <SensorValue label="Temperatura" value={machine.tempIn} unit="°C" />
        <SensorValue label="Pressão" value={machine.pressureIn} unit="bar" />
        <SensorValue label="Vazão" value={machine.flowIn} unit="L/min" />
      </SensorCard>

      <SensorCard title="Água de retorno do molde">
        <SensorValue label="Temperatura" value={machine.tempOut} unit="°C" />
        <SensorValue label="Pressão" value={machine.pressureOut} unit="bar" />
        <SensorValue label="Vazão" value={machine.flowOut} unit="L/min" />
      </SensorCard>
    </>
  )
}

export default function SimpleSensorsPage() {
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    const handleDashboardData = (payload: DashboardData) => setData(payload)
    socket.on('simple:dashboard:data', handleDashboardData)
    socket.emit('simple:dashboard:request')
    return () => { socket.off('simple:dashboard:data', handleDashboardData) }
  }, [])

  const machine = data?.machines[0] ?? null
  const timeStr = data?.timestamp ? data.timestamp.split('T')[1]?.split('.')[0] ?? data.timestamp : '--'

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-white p-6 space-y-4">
      <header className="bg-white border border-neutral-200 rounded-xl px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-neutral-900">Monitoramento de Sensores</h2>
            {machine && <p className="text-sm text-neutral-500">Máquina {machine.id} — {machine.name}</p>}
          </div>
          <span className="text-sm text-neutral-500">Atualizado às {timeStr}</span>
        </div>
      </header>

      {machine ? (
        <Sensors machine={machine} />
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center">
          <p className="text-sm text-neutral-500">Aguardando dados do simulador...</p>
        </div>
      )}
    </div>
  )
}
