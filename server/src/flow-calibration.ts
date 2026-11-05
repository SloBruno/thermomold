import { randomUUID } from 'node:crypto'
import type { FlowCalibrationState } from '../../shared/flow-calibration.js'
import type { createPumpStore } from './pumps.js'
import type { TelemetrySample } from './telemetry.js'

export const FLOW_FRESH_MS = 12_000
export const FLOW_LEASE_MS = 5_000
export const FLOW_MAX_MS = 120_000

export function createFlowCalibration(pumps: ReturnType<typeof createPumpStore>, now = Date.now) {
  let state: FlowCalibrationState = { phase: 'idle', referenceMl: 500, sampleCount: 0, applied: false }
  let latest: TelemetrySample | undefined
  let baseline: TelemetrySample | undefined
  let previous: TelemetrySample | undefined
  let leaseUntil = 0
  const active = () => state.phase === 'collecting' || state.phase === 'stopping'
  const get = (): FlowCalibrationState => ({ ...state,
    ...(state.phase === 'collecting' ? { elapsedMs: now() - state.startedAt! } : {}) })
  function off() { pumps.set({ pump1: false, pump2: false }) }
  function abort(error: string) {
    off()
    if (active()) state = { ...state, phase: 'failed', error, elapsedMs: now() - state.startedAt!, applied: false }
    return get()
  }
  function tick() {
    if (!active()) return
    if (now() > leaseUntil) { abort('Interface desconectada: comando OFF enviado.'); return }
    if (now() - state.startedAt! > FLOW_MAX_MS) { abort('Tempo máximo de coleta excedido.'); return }
    if (!latest || now() - Date.parse(latest.receivedAt) > FLOW_FRESH_MS) abort('Telemetria interrompida: coleta inválida.')
  }
  function start(referenceMl: unknown) {
    tick()
    if (active()) throw new Error('Já existe uma coleta em andamento.')
    if (pumps.control().mode === 'automatic') throw new Error('Desative o enchimento automático antes de iniciar a coleta.')
    if (typeof referenceMl !== 'number' || !Number.isFinite(referenceMl) || referenceMl <= 0 || referenceMl > 1_000_000) {
      throw new Error('Volume de referência deve estar entre 0 e 1.000.000 mL (maior que zero).')
    }
    if (!latest?.sensors?.flow || now() - Date.parse(latest.receivedAt) > FLOW_FRESH_MS
      || Math.abs(now() - Date.parse(latest.observedAt)) > FLOW_FRESH_MS) throw new Error('Aguarde telemetria de fluxo recente.')
    if (pumps.get().pump1 || pumps.get().pump2 || !latest.pumps || latest.pumps.pump1 || latest.pumps.pump2) {
      throw new Error('Desligue ambas as bombas e aguarde a telemetria antes de iniciar.')
    }
    baseline = latest
    previous = latest
    state = { id: randomUUID(), phase: 'collecting', referenceMl, startedAt: now(), sampleCount: 0,
      baselineObservedAt: latest.observedAt, source: latest.sensors.flow.rawTotalPulses === undefined ? 'filtered-total' : 'raw-pulses', applied: false }
    leaseUntil = now() + FLOW_LEASE_MS
    pumps.set({ pump1: true, pump2: true })
    return get()
  }
  function heartbeat(id: unknown) {
    tick()
    if (typeof id !== 'string' || id !== state.id) throw new Error('Coleta expirada ou identificador inválido.')
    if (active()) leaseUntil = now() + FLOW_LEASE_MS
    return get()
  }
  function stop() {
    off() // Always available, including without a live session.
    if (state.phase === 'collecting') state = { ...state, phase: 'stopping', stoppedAt: now(), elapsedMs: now() - state.startedAt! }
    return get()
  }
  function observe(sample: TelemetrySample) {
    tick()
    latest = sample
    if (!active() || !baseline) return
    const flow = sample.sensors?.flow
    const base = baseline.sensors!.flow!
    const prior = previous?.sensors?.flow
    if (!flow || sample.deviceId !== baseline.deviceId
      || Date.parse(sample.observedAt) <= Date.parse(previous!.observedAt)
      || flow.totalLiters < (prior?.totalLiters ?? 0)
      || (state.source === 'raw-pulses' && (flow.counterEpoch !== base.counterEpoch
        || flow.pulsesPerLiter !== base.pulsesPerLiter || flow.rawTotalPulses === undefined
        || flow.rawTotalPulses < prior!.rawTotalPulses!))) {
      abort('Contador reiniciado, dados fora de ordem ou contrato de fluxo alterado. Repita a coleta.'); return
    }
    previous = sample
    state = { ...state, sampleCount: state.sampleCount + 1, latestFlowLpm: flow.litersPerMinute }
    if (state.phase !== 'stopping' || Date.parse(sample.observedAt) <= state.stoppedAt!
      || !sample.pumps || sample.pumps.pump1 || sample.pumps.pump2) return
    const pulses = state.source === 'raw-pulses' ? flow.rawTotalPulses! - base.rawTotalPulses! : undefined
    const measuredMl = pulses === undefined ? (flow.totalLiters - base.totalLiters) * 1000 : pulses / base.pulsesPerLiter! * 1000
    if (!state.elapsedMs || measuredMl <= 0 || !Number.isFinite(measuredMl)) { abort('Tempo ou volume medido zero/inválido. Sem proposta de correção.'); return }
    state = { ...state, phase: 'complete', measuredMl, finalObservedAt: sample.observedAt,
      ...(pulses === undefined ? {} : { pulses, proposedFactor: state.referenceMl / measuredMl,
        proposedPulsesPerLiter: pulses / (state.referenceMl / 1000) }) }
  }
  return { get, active, start, heartbeat, stop, abort, observe, tick }
}
