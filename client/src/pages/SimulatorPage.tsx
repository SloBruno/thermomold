import { useState, useEffect } from 'react'
import socket from '../lib/socket'
import type { SimulatorState, MachineState } from 'shared/types'
import bkgImg from '../imgs/simulator_bkg.png'

const DEFAULT_MACHINES: MachineState[] = [
  { id: '1', name: 'Máquina 1', enabled: false, pumpSpeed: 50, obstruction: false, lowPressureFault: false, hotTowerWater: false },
  { id: '2', name: 'Máquina 2', enabled: false, pumpSpeed: 50, obstruction: false, lowPressureFault: false, hotTowerWater: false },
  { id: '3', name: 'Máquina 3', enabled: false, pumpSpeed: 50, obstruction: false, lowPressureFault: false, hotTowerWater: false },
]

let persistedState: SimulatorState | null = null

type FaultKey = keyof Pick<MachineState, 'lowPressureFault' | 'obstruction' | 'hotTowerWater'>

const FAULT_LABELS: Record<FaultKey, string> = {
  lowPressureFault: 'Baixa Pressão',
  obstruction: 'Obstrução Parcial',
  hotTowerWater: 'Água da Torre Quente',
}

export default function SimulatorPage() {
  const [state, setState] = useState<SimulatorState>(() => {
    if (persistedState) return persistedState
    return { ambientTemp: 25, centralPumpSpeed: 70, machines: DEFAULT_MACHINES }
  })

  useEffect(() => {
    socket.emit('simulator:state', state)
  }, [state])

  useEffect(() => {
    return () => { persistedState = state }
  }, [state])

  const updateMachine = (id: string, patch: Partial<MachineState>) => {
    setState(prev => ({
      ...prev,
      machines: prev.machines.map(m => (m.id === id ? { ...m, ...patch } : m)),
    }))
  }

  const handleTempChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setState(prev => ({ ...prev, ambientTemp: Number(e.target.value) }))
  }

  const handleToggle = (id: string) => {
    const m = state.machines.find(m => m.id === id)
    if (m) updateMachine(id, { enabled: !m.enabled })
  }

  const handlePumpSpeed = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    updateMachine(id, { pumpSpeed: Number(e.target.value) })
  }

  const handleFault = (id: string, fault: FaultKey) => {
    const m = state.machines.find(m => m.id === id)
    if (m) updateMachine(id, { [fault]: !m[fault] })
  }

  const handleCentralPump = (e: React.ChangeEvent<HTMLInputElement>) => {
    setState(prev => ({ ...prev, centralPumpSpeed: Number(e.target.value) }))
  }

  return (
    <div className="flex gap-6 p-6 h-[calc(100vh-4rem)]">
      <div className="flex-1 rounded-xl"
        style={{
          backgroundImage: `url(${bkgImg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />

      <div className="w-80 shrink-0 bg-slate-800/50 border border-slate-700 rounded-xl p-5 space-y-5 max-h-[calc(100vh-6rem)] overflow-y-auto">
        <div>
          <label className="flex items-center justify-between text-sm font-medium text-slate-300 mb-2">
            <span>Temperatura Ambiente</span>
            <span className="text-sky-400 font-bold tabular-nums">{state.ambientTemp}°C</span>
          </label>
          <input
            type="range"
            min={-10}
            max={55}
            value={state.ambientTemp}
            onChange={handleTempChange}
            className="w-full accent-sky-500"
          />
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>-10°C</span>
            <span>55°C</span>
          </div>
        </div>

        {/* Central Pump */}
        <div className="bg-slate-800/70 border border-sky-700/50 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.5)]" />
            <span className="text-sm font-semibold text-slate-200">Bomba Central</span>
          </div>
          <label className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Velocidade</span>
            <span className="font-bold tabular-nums text-sky-400">{state.centralPumpSpeed}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={state.centralPumpSpeed}
            onChange={handleCentralPump}
            className="w-full accent-sky-500"
          />
        </div>

        {state.machines.map(machine => {
          const enabled = machine.enabled
          return (
            <div key={machine.id} className="bg-slate-800/70 border border-slate-700 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full transition-colors ${
                    enabled
                      ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                      : 'bg-slate-600'
                  }`} />
                  <span className="text-sm font-semibold text-slate-200">{machine.name}</span>
                </div>
                <button
                  onClick={() => handleToggle(machine.id)}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                    enabled
                      ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                      : 'bg-slate-600 text-slate-400 hover:bg-slate-500'
                  }`}
                >
                  {enabled ? 'Ligado' : 'Desligado'}
                </button>
              </div>

              <div>
                <label className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>Velocidade da Bomba</span>
                  <span className={`font-bold tabular-nums ${enabled ? 'text-sky-400' : 'text-slate-500'}`}>
                    {machine.pumpSpeed}%
                  </span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={machine.pumpSpeed}
                  onChange={(e) => handlePumpSpeed(machine.id, e)}
                  disabled={!enabled}
                  className="w-full accent-sky-500 disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-slate-500 font-medium">Falhas</span>
                {(Object.keys(FAULT_LABELS) as FaultKey[]).map(key => (
                  <label key={key} className={`flex items-center gap-2 text-xs cursor-pointer transition-colors ${
                    enabled ? 'text-slate-400 hover:text-slate-300' : 'text-slate-600 cursor-not-allowed'
                  }`}>
                    <input
                      type="checkbox"
                      checked={machine[key]}
                      onChange={() => handleFault(machine.id, key)}
                      disabled={!enabled}
                      className="accent-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                    {FAULT_LABELS[key]}
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
