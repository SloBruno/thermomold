import { useState, useEffect, useCallback, useRef } from 'react'
import socket from '../lib/socket'
import type { SimulatorState, MachineState, DashboardData, MachineData, MoldLibrary, MoldParameters } from 'shared/types'
import bkgImg from '../imgs/bkg_simple.jpeg'

interface ConditionGroup {
  group: string
  items: Condition[]
}

interface Condition {
  id: string
  label: string
  desc: string
  effect: string
  mapsTo: Partial<Pick<MachineState, 'obstruction' | 'lowPressureFault' | 'hotTowerWater'>>
}

const CONDITION_GROUPS: ConditionGroup[] = [
  {
    group: 'Entrada',
    items: [
      {
        id: 'highTemp',
        label: 'Temperatura de entrada elevada',
        desc: 'Água fria chega mais quente que o normal',
        effect: 'Dificuldade em resfriar o molde',
        mapsTo: { hotTowerWater: true },
      },
      {
        id: 'inletBlocked',
        label: 'Obstrução no cano de entrada',
        desc: 'Sujeira ou fechamento parcial na tubulação',
        effect: 'Vazão baixa mesmo com bomba no máximo',
        mapsTo: { obstruction: true },
      },
      {
        id: 'lowPressure',
        label: 'Baixa pressão no sistema',
        desc: 'Vazamento ou alimentação insuficiente',
        effect: 'Pressão baixa em todo o circuito',
        mapsTo: { lowPressureFault: true },
      },
    ],
  },
  {
    group: 'Saída (Canal do Molde)',
    items: [
      {
        id: 'channelBlocked',
        label: 'Canal de refrigeração obstruído',
        desc: 'Incrustação ou sujeira nos canais internos',
        effect: 'Troca térmica reduzida pelo acúmulo',
        mapsTo: { obstruction: true },
      },
      {
        id: 'returnHoseKinked',
        label: 'Mangueira de retorno pinçada',
        desc: 'Mangueira dobrada após manutenção',
        effect: 'Restrição severa na saída de água',
        mapsTo: { obstruction: true },
      },
      {
        id: 'channelDamaged',
        label: 'Canal danificado (desvio interno)',
        desc: 'Vedação rompida entre canais do molde',
        effect: 'Água desvia do ponto de aquecimento',
        mapsTo: { obstruction: true, lowPressureFault: true },
      },
    ],
  },
]

const MACHINE_ID = '1'

const DEFAULT_MOLD: MoldParameters = {
  id: 'default',
  name: 'Molde Padrão',
  targetTemp: 80,
  tempIn: { target: 29, tolerance: 3 },
  tempOut: { target: 57.5, tolerance: 7.5 },
  pressure: { target: 2.75, tolerance: 0.75 },
  flow: { target: 12.5, tolerance: 3.5 },
  deltaT: { target: 21, tolerance: 9 },
  heatExchange: { target: 20, tolerance: 2 },
}

function autoDirection(machine: MachineData, mold: MoldParameters): -1 | 0 | 1 {
  const flowMin = mold.flow.target - mold.flow.tolerance
  const flowMax = mold.flow.target + mold.flow.tolerance
  const pressureMin = mold.pressure.target - mold.pressure.tolerance
  const tempOutMin = mold.tempOut.target - mold.tempOut.tolerance
  const tempOutMax = mold.tempOut.target + mold.tempOut.tolerance
  const deltaTMax = mold.deltaT.target + mold.deltaT.tolerance
  const heatMin = mold.heatExchange.target - mold.heatExchange.tolerance
  const heatMax = mold.heatExchange.target + mold.heatExchange.tolerance
  const needsMoreFlow = machine.flowIn < flowMin
    || machine.flowOut < flowMin
    || machine.pressureIn < pressureMin
    || machine.pressureOut < pressureMin
    || machine.deltaT > deltaTMax
    || machine.tempOut > tempOutMax
    || machine.heatRemoved < heatMin
  const needsLessFlow = machine.flowIn > flowMax
    || machine.flowOut > flowMax
    || machine.tempOut < tempOutMin
    || machine.heatRemoved > heatMax

  if (needsMoreFlow === needsLessFlow) return 0
  return needsMoreFlow ? 1 : -1
}

function allConditions(): Condition[] {
  return CONDITION_GROUPS.flatMap(g => g.items)
}

function buildMachine(active: Set<string>, pumpSpeed: number): MachineState {
  const items = allConditions()
  const obstruction = items.some(c => active.has(c.id) && c.mapsTo.obstruction)
  const lowPressureFault = items.some(c => active.has(c.id) && c.mapsTo.lowPressureFault)
  const hotTowerWater = items.some(c => active.has(c.id) && c.mapsTo.hotTowerWater)

  return {
    id: MACHINE_ID,
    name: 'Unidade Simplificada',
    enabled: true,
    pumpSpeed,
    obstruction,
    lowPressureFault,
    hotTowerWater,
    simpleFaults: Array.from(active),
  }
}

let persistedState: { ambientTemp: number; pumpSpeed: number; activeConditions: string[] } | null = null

export default function SimpleSimulatorPage() {
  const [ambientTemp, setAmbientTemp] = useState(() => persistedState?.ambientTemp ?? 25)
  const [pumpSpeed, setPumpSpeed] = useState(() => persistedState?.pumpSpeed ?? 50)
  const [activeConditions, setActiveConditions] = useState<Set<string>>(
    () => new Set(persistedState?.activeConditions ?? [])
  )
  const [autoMode, setAutoMode] = useState(false)
  const [machineData, setMachineData] = useState<MachineData | null>(null)
  const [library, setLibrary] = useState<MoldLibrary | null>(null)
  const machineDataRef = useRef<MachineData | null>(null)
  const moldRef = useRef<MoldParameters>(DEFAULT_MOLD)

  useEffect(() => {
    const machine = buildMachine(activeConditions, pumpSpeed)
    const state: SimulatorState = { ambientTemp, centralPumpSpeed: 70, machines: [machine] }
    socket.emit('simple:simulator:state', state)
  }, [ambientTemp, pumpSpeed, activeConditions])

  useEffect(() => {
    const handleDashboardData = (payload: DashboardData) => {
      const machine = payload.machines[0] ?? null
      machineDataRef.current = machine
      setMachineData(machine)
    }
    socket.on('simple:dashboard:data', handleDashboardData)
    socket.emit('simple:dashboard:request')
    return () => { socket.off('simple:dashboard:data', handleDashboardData) }
  }, [])

  useEffect(() => {
    const handleMolds = (payload: MoldLibrary) => {
      setLibrary(payload)
      moldRef.current = payload.molds.find(mold => mold.id === payload.activeMoldId) ?? DEFAULT_MOLD
    }
    socket.on('simple:molds:data', handleMolds)
    socket.emit('simple:molds:request')
    return () => { socket.off('simple:molds:data', handleMolds) }
  }, [])

  useEffect(() => {
    if (!autoMode) return

    const timer = window.setInterval(() => {
      const machine = machineDataRef.current
      if (!machine) return

      const direction = autoDirection(machine, moldRef.current)
      setPumpSpeed(current => Math.min(100, Math.max(0, current + direction)))
    }, 800)

    return () => { window.clearInterval(timer) }
  }, [autoMode])

  useEffect(() => {
    if (activeConditions.size > 0) setAutoMode(false)
  }, [activeConditions])

  useEffect(() => {
    return () => {
      persistedState = { ambientTemp, pumpSpeed, activeConditions: Array.from(activeConditions) }
    }
  })

  const toggleCondition = useCallback((id: string) => {
    setActiveConditions(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const activeMold = library?.molds.find(mold => mold.id === library.activeMoldId) ?? DEFAULT_MOLD
  const direction = machineData ? autoDirection(machineData, activeMold) : 0
  const autoMessage = !autoMode
    ? 'Ajuste manual ativo'
    : direction > 0
      ? 'Aumentando a bomba gradualmente'
      : direction < 0
        ? 'Reduzindo a bomba gradualmente'
        : machineData?.status === 'normal'
          ? 'Faixa ideal atingida'
          : 'Condição não ajustável só pela bomba'

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-white p-6 space-y-4">
      <header className="bg-white border border-neutral-200 rounded-xl px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-neutral-900">Simulador de Refrigeração</h2>
            <p className="text-sm text-neutral-500">Ajuste as condições da unidade e acompanhe o resultado no monitoramento.</p>
          </div>
          <span className="text-sm font-bold text-neutral-700">{activeMold.name}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="bg-white border border-neutral-200 rounded-xl p-5 space-y-3 min-h-[28rem]">
          <h3 className="text-base font-bold text-neutral-900">Circuito de Refrigeração</h3>
          <div
            className="min-h-[24rem] h-full rounded-lg border border-neutral-200 bg-neutral-50"
            style={{
              backgroundImage: `url(${bkgImg})`,
              backgroundSize: 'contain',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }}
          />
        </section>

        <aside className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto">
          <h3 className="text-base font-bold text-neutral-900">Controles do Simulador</h3>

          <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 space-y-2">
            <label className="flex items-center justify-between text-sm font-bold text-neutral-900">
              <span>Temperatura Ambiente</span>
              <span className="tabular-nums">{ambientTemp}°C</span>
            </label>
            <input
              type="range"
              min={-10}
              max={55}
              value={ambientTemp}
              onChange={e => setAmbientTemp(Number(e.target.value))}
              className="w-full accent-neutral-700"
            />
            <div className="flex justify-between text-sm text-neutral-500">
              <span>-10°C</span>
              <span>55°C</span>
            </div>
          </div>

          <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-neutral-900">Bomba de Água</span>
              <span className="text-sm font-bold tabular-nums text-neutral-900">{pumpSpeed}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={pumpSpeed}
              onChange={e => setPumpSpeed(Number(e.target.value))}
              disabled={autoMode}
              className="w-full accent-neutral-700"
            />
            <p className="text-sm text-neutral-500">
              {pumpSpeed < 20 ? 'Fluxo baixo' : pumpSpeed < 60 ? 'Fluxo moderado' : 'Fluxo alto'}
            </p>
            <button
              type="button"
              onClick={() => setAutoMode(enabled => !enabled)}
              disabled={activeConditions.size > 0}
              className={`w-full rounded-md border px-3 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:border-neutral-200 disabled:text-neutral-400 ${
                autoMode
                  ? 'bg-green-700 border-green-700 text-white hover:bg-green-600'
                  : 'bg-neutral-800 border-neutral-800 text-white hover:bg-neutral-700'
              }`}
            >
              {autoMode ? 'Desativar modo automático' : 'Ativar modo automático'}
            </button>
            <p className={`text-sm ${autoMode ? 'text-green-700' : 'text-neutral-500'}`}>
              {activeConditions.size > 0 ? 'Desative as falhas para usar o modo automático.' : autoMessage}
            </p>
          </div>

          <div className="space-y-4">
            {CONDITION_GROUPS.map(group => (
              <section key={group.group} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-neutral-900">{group.group}</h4>
                  {group.items.some(c => activeConditions.has(c.id)) && (
                    <span className="text-sm bg-red-100 border border-red-300 text-red-700 px-2 py-0.5 rounded-full">
                      {group.items.filter(c => activeConditions.has(c.id)).length}
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  {group.items.map(cond => {
                    const active = activeConditions.has(cond.id)
                    return (
                      <button
                        key={cond.id}
                        type="button"
                        onClick={() => toggleCondition(cond.id)}
                        className={`w-full text-left rounded-lg p-3 border transition-colors ${
                          active
                            ? 'border-red-300 bg-red-50'
                            : 'border-neutral-200 bg-neutral-50 hover:border-neutral-400'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <p className={`text-sm font-bold leading-tight ${active ? 'text-red-700' : 'text-neutral-900'}`}>
                              {cond.label}
                            </p>
                            <p className="text-sm text-neutral-500">{cond.desc}</p>
                          </div>
                          <div className={`shrink-0 w-4 h-4 rounded border-2 mt-0.5 flex items-center justify-center ${
                            active
                              ? 'border-red-600 bg-red-600'
                              : 'border-neutral-400 bg-white'
                          }`}>
                            {active && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </div>
                        {active && (
                          <p className="text-sm text-red-700 mt-2 pt-2 border-t border-red-300">
                            {cond.effect}
                          </p>
                        )}
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}
