import { useState, useEffect } from 'react'
import socket from '../lib/socket'
import type { DashboardData, MachineData } from 'shared/types'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'

const STATUS_STYLES = {
  normal: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  attention: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  critical: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
} as const

const ALERT_STYLES = {
  normal: 'border-emerald-500/30 bg-emerald-500/10',
  attention: 'border-amber-500/30 bg-amber-500/10',
  critical: 'border-rose-500/30 bg-rose-500/10',
} as const

function Metric({ label, value, bar }: { label: string; value: string; bar?: number }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-200 tabular-nums">{value}</p>
      {bar !== undefined && (
        <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-sky-400 rounded-full transition-all"
            style={{ width: `${bar}%` }}
          />
        </div>
      )}
    </div>
  )
}

function MachineCard({ machine, history }: { machine: MachineData; history: { tempOut: number }[] }) {
  if (!machine.enabled) {
    return (
      <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 opacity-50">
        <h3 className="text-sm font-bold text-slate-500 mb-4">{machine.name}</h3>
        <p className="text-slate-600 text-center py-8 text-sm">Máquina desligada</p>
      </div>
    )
  }

  const chartData = history.map((d, i) => ({ index: i, ...d }))

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-200">{machine.name}</h3>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${STATUS_STYLES[machine.status]}`}>
          {machine.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Metric label="Temp In" value={`${machine.tempIn}°C`} />
        <Metric label="Temp Out" value={`${machine.tempOut}°C`} />
        <Metric label="Delta T" value={`${machine.deltaT}°C`} />
        <Metric label="Flow" value={`${machine.flow} L/min`} />
        <Metric label="Calor Removido" value={`${machine.heatRemoved} kW`} />
        <Metric label="Pressure" value={`${machine.pressure} bar`} />
        <Metric label="Pump Speed" value={`${machine.pumpSpeed}%`} bar={machine.pumpSpeed} />
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Temp Out (últimos 10)</p>
        <ResponsiveContainer width="100%" height={72}>
          <LineChart data={chartData}>
            <XAxis dataKey="index" hide />
            <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(value: number) => [`${value.toFixed(1)}°C`, 'Temp Out']}
            />
            <Line type="monotone" dataKey="tempOut" stroke="#38bdf8" dot={false} strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className={`border rounded-lg p-3 ${ALERT_STYLES[machine.status]}`}>
        <p className="text-xs text-slate-300">{machine.alert}</p>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [history, setHistory] = useState<Record<string, { tempOut: number }[]>>({})

  useEffect(() => {
    socket.emit('dashboard:request')
    socket.on('dashboard:data', (payload: DashboardData) => {
      setData(payload)
      setHistory(prev => {
        const next = { ...prev }
        for (const machine of payload.machines) {
          next[machine.id] = [...(prev[machine.id] ?? []), { tempOut: machine.tempOut }].slice(-10)
        }
        return next
      })
    })
    return () => { socket.off('dashboard:data') }
  }, [])

  const total = data?.machines.length ?? 0
  const enabled = data?.machines.filter(m => m.enabled).length ?? 0
  const disabled = total - enabled

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-200">Dashboard</h2>
        <span className="text-sm text-slate-400 tabular-nums">
          {data?.timestamp ?? '--'}
        </span>
      </div>

      <p className="text-sm text-slate-400">
        {total} máquinas —{' '}
        <span className="text-emerald-400">{enabled} ligadas</span>
        {' | '}
        <span className="text-rose-400">{disabled} desligadas</span>
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {(data?.machines ?? []).map(machine => (
          <MachineCard
            key={machine.id}
            machine={machine}
            history={history[machine.id] ?? []}
          />
        ))}
      </div>
    </div>
  )
}
