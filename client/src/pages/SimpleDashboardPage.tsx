import { useState, useEffect } from 'react'
import socket from '../lib/socket'
import type { DashboardData, MachineData, MoldLibrary, MoldParameters, SensorParameter } from 'shared/types'

interface IdealRange {
  min: number
  max: number
  scaleMax: number
}

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

function range(parameter: SensorParameter, minScaleMax: number): IdealRange {
  const max = parameter.target + parameter.tolerance
  return { min: parameter.target - parameter.tolerance, max, scaleMax: Math.max(minScaleMax, max * 1.15) }
}

function rangesFor(mold: MoldParameters): Record<string, IdealRange> {
  return {
    tempIn: range(mold.tempIn, 60),
    pressure: range(mold.pressure, 8),
    flow: range(mold.flow, 40),
    tempOut: range(mold.tempOut, 120),
    deltaT: range(mold.deltaT, 80),
    heatRemoved: range(mold.heatExchange, 60),
  }
}

function RangeBar({ value, range }: { value: number; range: IdealRange }) {
  const pct = (v: number) => Math.min(100, Math.max(0, (v / range.scaleMax) * 100))
  const idealLeft = pct(range.min)
  const idealWidth = pct(range.max) - idealLeft
  const valPct = pct(value)

  const isLow = value < range.min
  const isHigh = value > range.max
  const zoneColor = isLow ? 'bg-red-500' : isHigh ? 'bg-yellow-500' : 'bg-green-500'

  return (
    <div className="relative w-full h-4">
      <div className="absolute inset-0 bg-neutral-200 rounded-full" />
      <div
        className="absolute top-0 h-full rounded-full bg-green-500 border border-green-600"
        style={{ left: `${idealLeft}%`, width: `${idealWidth}%` }}
      />
      <div
        className={`absolute top-1/2 -translate-y-1/2 w-1 h-6 rounded-full border border-white transition-all ${zoneColor}`}
        style={{ left: `calc(${valPct}% - 2px)` }}
      />
    </div>
  )
}

function MetricMini({ label, value, unit, range }: {
  label: string
  value: number
  unit: string
  range: IdealRange
}) {
  const status = value < range.min ? 'Abaixo' : value > range.max ? 'Acima' : 'Ideal'
  const statusColor = value < range.min ? 'text-red-600' : value > range.max ? 'text-yellow-600' : 'text-green-600'

  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-sm uppercase tracking-wider text-neutral-500">{label}</p>
        <span className={`text-sm font-semibold ${statusColor}`}>{status}</span>
      </div>
      <p className="text-xl font-bold text-neutral-900 tabular-nums leading-none">
        {value} <span className="text-sm font-normal text-neutral-400">{unit}</span>
      </p>
      <RangeBar value={value} range={range} />
      <p className="text-sm text-neutral-400">Faixa ideal: {range.min} a {range.max} {unit}</p>
    </div>
  )
}

function analyze(machine: MachineData, ranges: Record<string, IdealRange>): {
  diagnosis: string
  cause: string
  action: string
  status: 'critical' | 'attention' | 'normal'
} {
  if (!machine.enabled) {
    return { diagnosis: 'Máquina desligada', cause: '—', action: 'Ligar a máquina.', status: 'normal' }
  }

  const faults = new Set(machine.simpleFaults ?? [])
  const faultStatus = machine.status === 'critical' ? 'critical' : 'attention'

  if (faults.has('inletBlocked')) {
    return {
      diagnosis: 'Vazão abaixo do recomendado',
      cause: 'Obstrução na entrada',
      action: 'Verificar cano de entrada.',
      status: faultStatus,
    }
  }

  if (faults.has('returnHoseKinked')) {
    return {
      diagnosis: 'Restrição no retorno da água',
      cause: 'Mangueira pinçada',
      action: 'Verificar mangueira de retorno.',
      status: faultStatus,
    }
  }

  if (faults.has('channelBlocked')) {
    return {
      diagnosis: 'Refrigeração insuficiente',
      cause: 'Canal obstruído',
      action: 'Verificar canais do molde.',
      status: faultStatus,
    }
  }

  if (faults.has('channelDamaged')) {
    return {
      diagnosis: 'Troca térmica irregular',
      cause: 'Canal danificado',
      action: 'Verificar o molde.',
      status: faultStatus,
    }
  }

  if (faults.has('lowPressure')) {
    return {
      diagnosis: 'Pressão do sistema abaixo do ideal',
      cause: 'Baixa pressão no sistema',
      action: 'Verificar mangueiras e conexões.',
      status: faultStatus,
    }
  }

  if (faults.has('highTemp')) {
    return {
      diagnosis: 'Água de entrada acima do ideal',
      cause: 'Torre de refrigeração ineficiente',
      action: 'Verificar a torre de resfriamento.',
      status: faultStatus,
    }
  }

  if (machine.tempOut > ranges.tempOut.max + 10 || machine.flow < Math.max(0.5, ranges.flow.min * 0.45)) {
    return {
      diagnosis: 'Risco de superaquecimento do molde',
      cause: 'Vazão muito baixa',
      action: 'Aumentar a bomba e verificar obstruções.',
      status: 'critical',
    }
  }

  if (machine.heatRemoved < Math.max(0.5, ranges.heatRemoved.min * 0.4)) {
    return {
      diagnosis: 'Refrigeração crítica',
      cause: 'Pouco resfriamento',
      action: 'Verificar os canais de refrigeração.',
      status: 'critical',
    }
  }

  if (machine.heatRemoved < ranges.heatRemoved.min) {
    return {
      diagnosis: 'Refrigeração insuficiente',
      cause: 'Vazão abaixo do necessário',
      action: 'Aumentar a velocidade da bomba.',
      status: 'attention',
    }
  }

  if (machine.tempIn > ranges.tempIn.max) {
    return {
      diagnosis: 'Água de entrada acima do ideal',
      cause: 'Torre de refrigeração ineficiente',
      action: 'Verificar a torre de resfriamento.',
      status: 'attention',
    }
  }

  if (machine.tempIn < ranges.tempIn.min) {
    return {
      diagnosis: 'Água de entrada abaixo do ideal',
      cause: 'Água muito fria',
      action: 'Verificar o ajuste de refrigeração.',
      status: 'attention',
    }
  }

  if (machine.pressure < ranges.pressure.min) {
    return {
      diagnosis: 'Pressão do sistema abaixo do ideal',
      cause: 'Vazamento ou obstrução',
      action: 'Verificar mangueiras e conexões.',
      status: 'attention',
    }
  }

  if (machine.pressure > ranges.pressure.max) {
    return {
      diagnosis: 'Pressão do sistema acima do ideal',
      cause: 'Pressão muito alta',
      action: 'Reduzir a velocidade da bomba.',
      status: 'attention',
    }
  }

  if (machine.heatRemoved > ranges.heatRemoved.max) {
    return {
      diagnosis: 'Refrigeração acima do necessário',
      cause: 'Vazão muito alta',
      action: 'Reduzir a velocidade da bomba.',
      status: 'attention',
    }
  }

  if (machine.tempOut > ranges.tempOut.max) {
    return {
      diagnosis: 'Temperatura de retorno elevada',
      cause: machine.flow < ranges.flow.min ? 'Vazão baixa' : 'Água de entrada quente',
      action: machine.flow < ranges.flow.min ? 'Aumentar a vazão.' : 'Verificar a torre de resfriamento.',
      status: 'attention',
    }
  }

  if (machine.flow < ranges.flow.min) {
    return {
      diagnosis: 'Vazão abaixo do recomendado',
      cause: 'Bomba baixa ou obstrução',
      action: 'Aumentar a bomba.',
      status: 'attention',
    }
  }

  if (machine.deltaT > ranges.deltaT.max) {
    return {
      diagnosis: 'Delta T acima do ideal',
      cause: 'Vazão baixa',
      action: 'Aumentar a velocidade da bomba.',
      status: 'attention',
    }
  }

  if (machine.deltaT < ranges.deltaT.min) {
    return {
      diagnosis: 'Delta T abaixo do ideal',
      cause: 'Troca térmica baixa',
      action: 'Verificar o circuito de refrigeração.',
      status: 'attention',
    }
  }

  if (machine.tempOut < ranges.tempOut.min) {
    return {
      diagnosis: 'Temperatura de retorno abaixo do ideal',
      cause: 'Vazão muito alta',
      action: 'Reduzir a velocidade da bomba.',
      status: 'attention',
    }
  }

  if (machine.flow > ranges.flow.max) {
    return {
      diagnosis: 'Vazão acima do recomendado',
      cause: 'Vazão muito alta',
      action: 'Reduzir a velocidade da bomba.',
      status: 'attention',
    }
  }

  return {
    diagnosis: 'Refrigeração dentro da faixa esperada',
    cause: 'Sistema estável',
    action: 'Nenhuma ação necessária.',
    status: 'normal',
  }
}

const STATUS_LABEL: Record<string, string> = {
  normal: 'Normal',
  attention: 'Atenção',
  critical: 'Crítico',
}

function deltaTLabel(deltaT: number, range: IdealRange): { label: string; color: string } {
  if (deltaT < Math.max(1, range.min * 0.4)) return { label: 'Crítico', color: 'text-red-600' }
  if (deltaT < range.min) return { label: 'Abaixo', color: 'text-yellow-600' }
  if (deltaT > range.max) return { label: 'Elevado', color: 'text-yellow-600' }
  return { label: 'Normal', color: 'text-green-600' }
}

function HeaderCard({ machine, timestamp, library, ranges, onSelectMold }: {
  machine: MachineData | null
  timestamp: string
  library: MoldLibrary | null
  ranges: Record<string, IdealRange>
  onSelectMold: (moldId: string) => void
}) {
  const analysis = machine ? analyze(machine, ranges) : null
  const timeStr = timestamp ? timestamp.split('T')[1]?.split('.')[0] ?? timestamp : '--'

  const statusBg = analysis?.status === 'critical' ? 'bg-red-100 border-red-300 text-red-700'
    : analysis?.status === 'attention' ? 'bg-yellow-100 border-yellow-300 text-yellow-700'
    : 'bg-green-100 border-green-300 text-green-700'

  return (
    <div className="bg-white border border-neutral-200 rounded-xl px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-neutral-900">Resumo Operacional</h2>
          {machine && (
            <p className="text-sm text-neutral-500">Máquina {machine.id} — {machine.name}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {library && (
            <label className="flex items-center gap-2">
              <span className="text-sm font-bold text-neutral-700">Molde</span>
              <select
                value={library.activeMoldId}
                onChange={event => onSelectMold(event.target.value)}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 outline-none focus:border-neutral-700"
              >
                {library.molds.map(mold => <option key={mold.id} value={mold.id}>{mold.name}</option>)}
              </select>
            </label>
          )}
          {analysis && (
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-neutral-900">Status Geral</p>
              <span className={`inline-flex px-3 py-1 rounded-full text-sm font-bold border ${statusBg}`}>
                {STATUS_LABEL[analysis.status]}
              </span>
            </div>
          )}
          <span className="text-sm text-neutral-400 whitespace-nowrap">Atualizado às {timeStr}</span>
        </div>
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
      <h3 className="text-base font-bold text-neutral-900">{title}</h3>
      {children}
    </div>
  )
}

function InletCard({ machine, ranges }: { machine: MachineData; ranges: Record<string, IdealRange> }) {
  return (
    <Card title="Água de entrada no molde">
      <div className="grid grid-cols-3 gap-3">
        <MetricMini label="Temp" value={machine.tempIn} unit="°C" range={ranges.tempIn} />
        <MetricMini label="Pressão" value={machine.pressureIn} unit="bar" range={ranges.pressure} />
        <MetricMini label="Vazão" value={machine.flowIn} unit="L/min" range={ranges.flow} />
      </div>
    </Card>
  )
}

function OutletCard({ machine, ranges }: { machine: MachineData; ranges: Record<string, IdealRange> }) {
  return (
    <Card title="Água de retorno do molde">
      <div className="grid grid-cols-3 gap-3">
        <MetricMini label="Temp Out" value={machine.tempOut} unit="°C" range={ranges.tempOut} />
        <MetricMini label="Pressão" value={machine.pressureOut} unit="bar" range={ranges.pressure} />
        <MetricMini label="Vazão" value={machine.flowOut} unit="L/min" range={ranges.flow} />
      </div>
    </Card>
  )
}

function ResultsCard({ machine, ranges }: { machine: MachineData; ranges: Record<string, IdealRange> }) {
  const { label: dtLabel, color: dtColor } = deltaTLabel(machine.deltaT, ranges.deltaT)

  const hrStatus = machine.heatRemoved < ranges.heatRemoved.min ? 'Baixo' : machine.heatRemoved > ranges.heatRemoved.max ? 'Excessivo' : 'Ideal'
  const hrColor = machine.heatRemoved < ranges.heatRemoved.min ? 'text-red-600' : machine.heatRemoved > ranges.heatRemoved.max ? 'text-yellow-600' : 'text-green-600'

  return (
    <Card title="Resultado Térmico">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-sm uppercase tracking-wider text-neutral-500">Delta T</p>
            <span className={`text-sm font-semibold ${dtColor}`}>{dtLabel}</span>
          </div>
          <p className="text-xl font-bold text-neutral-900 tabular-nums">
            {machine.deltaT} <span className="text-sm font-normal text-neutral-400">°C</span>
          </p>
          <RangeBar value={machine.deltaT} range={ranges.deltaT} />
          <p className="text-sm text-neutral-400">Faixa ideal: {ranges.deltaT.min} a {ranges.deltaT.max} °C</p>
        </div>
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-sm uppercase tracking-wider text-neutral-500">Calor Removido</p>
            <span className={`text-sm font-semibold ${hrColor}`}>{hrStatus}</span>
          </div>
          <p className="text-xl font-bold text-neutral-900 tabular-nums">
            {machine.heatRemoved} <span className="text-sm font-normal text-neutral-400">kW</span>
          </p>
          <RangeBar value={machine.heatRemoved} range={ranges.heatRemoved} />
          <p className="text-sm text-neutral-400">Faixa ideal: {ranges.heatRemoved.min} a {ranges.heatRemoved.max} kW</p>
        </div>
      </div>
    </Card>
  )
}

function AnalysisCard({ machine, ranges }: { machine: MachineData; ranges: Record<string, IdealRange> }) {
  const { diagnosis, cause, action, status } = analyze(machine, ranges)

  const accentColor = status === 'critical' ? 'text-red-600'
    : status === 'attention' ? 'text-yellow-600'
    : 'text-green-600'

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
      <h3 className="text-base font-bold text-neutral-900">Análise do Sistema</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <p className="text-sm font-bold text-neutral-900">Diagnóstico</p>
          <p className={`text-sm leading-relaxed ${accentColor}`}>{diagnosis}</p>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-bold text-neutral-900">Causa Provável</p>
          <p className="text-sm text-neutral-600 leading-relaxed">{cause}</p>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-bold text-neutral-900">Ação Recomendada</p>
          <p className="text-sm text-neutral-600 leading-relaxed">{action}</p>
        </div>
      </div>
    </div>
  )
}

export default function SimpleDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [library, setLibrary] = useState<MoldLibrary | null>(null)

  useEffect(() => {
    const handleDashboardData = (payload: DashboardData) => setData(payload)
    const handleMolds = (payload: MoldLibrary) => setLibrary(payload)
    socket.on('simple:dashboard:data', handleDashboardData)
    socket.on('simple:molds:data', handleMolds)
    socket.emit('simple:dashboard:request')
    socket.emit('simple:molds:request')
    return () => {
      socket.off('simple:dashboard:data', handleDashboardData)
      socket.off('simple:molds:data', handleMolds)
    }
  }, [])

  const machine = data?.machines[0] ?? null
  const mold = library?.molds.find(item => item.id === library.activeMoldId) ?? DEFAULT_MOLD
  const ranges = rangesFor(mold)

  return (
    <div className="p-6 space-y-4 bg-white min-h-[calc(100vh-4rem)]">
      <HeaderCard
        machine={machine}
        timestamp={data?.timestamp ?? ''}
        library={library}
        ranges={ranges}
        onSelectMold={moldId => socket.emit('simple:molds:activate', moldId)}
      />

      {machine ? (
        <>
          <AnalysisCard machine={machine} ranges={ranges} />
          <InletCard machine={machine} ranges={ranges} />
          <OutletCard machine={machine} ranges={ranges} />
          <ResultsCard machine={machine} ranges={ranges} />
        </>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center">
          <p className="text-neutral-500 text-sm">Aguardando dados do simulador...</p>
        </div>
      )}
    </div>
  )
}
