import { randomUUID } from 'node:crypto'

export interface PumpState {
  pump1: boolean
  pump2: boolean
}

export type PumpId = keyof PumpState

const PUMP_IDS: readonly PumpId[] = ['pump1', 'pump2']

export function isPumpId(value: string): value is PumpId {
  return (PUMP_IDS as readonly string[]).includes(value)
}

export function createPumpStore() {
  let state: PumpState = { pump1: false, pump2: false }
  let mode: 'manual' | 'automatic' = 'manual'
  const session = randomUUID()
  let revision = 0
  let deviceSession = ''
  let tripAck = 0
  let baselineConfirmed = false
  let baselineRevision = 0
  const retiredBoots = new Set<string>()
  const control = () => ({ ...state, mode, session, revision, deviceSession })
  function register(boot: string) {
    if (boot === deviceSession) return true
    if (retiredBoots.has(boot)) return false
    if (deviceSession) retiredBoots.add(deviceSession)
    deviceSession = boot
    tripAck = 0
    mode = 'manual'; state = { pump1: false, pump2: false }; revision++
    baselineConfirmed = false; baselineRevision = revision
    return true
  }
  function acknowledgeTrip(boot: string, generation: number) {
    if (boot !== deviceSession || generation <= tripAck) return
    tripAck = generation
    mode = 'manual'; state = { pump1: false, pump2: false }; revision++
    baselineConfirmed = false; baselineRevision = revision
  }
  function observeBaseline(boot: string, reported: { session: string; revision: number; mode: string; tripGeneration?: number }, actual?: PumpState) {
    if (boot === deviceSession && reported.session === session && reported.revision === baselineRevision
      && reported.mode === 'manual' && reported.tripGeneration === tripAck
      && actual && !actual.pump1 && !actual.pump2) baselineConfirmed = true
  }
  function setMode(input: unknown) {
    const value = input as { mode?: unknown; session?: unknown; revision?: unknown } | null
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(k => !['mode', 'session', 'revision'].includes(k))
      || !['manual', 'automatic'].includes(value.mode as string)) return { ok: false as const, error: 'modo inválido' }
    if (value.mode === 'automatic' && (!baselineConfirmed || !deviceSession || value.session !== session || value.revision !== revision)) {
      return { ok: false as const, error: 'Estado expirado ou firmware incompatível; atualize e habilite intencionalmente.' }
    }
    mode = value.mode as 'manual' | 'automatic'
    state = { pump1: false, pump2: false }; revision++
    if (!baselineConfirmed) baselineRevision = revision
    return { ok: true as const, value: control() }
  }

  function get(): PumpState {
    return { ...state }
  }

  function set(input: unknown): { ok: true; value: PumpState } | { ok: false; error: string } {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { ok: false, error: 'comando de bombas inválido' }
    }

    const next = { ...state }
    for (const [key, value] of Object.entries(input)) {
      if (!isPumpId(key)) return { ok: false, error: `bomba desconhecida: ${key}` }
      if (typeof value !== 'boolean') return { ok: false, error: `${key} deve ser true ou false` }
      next[key] = value
    }

    if (!baselineConfirmed && Object.values(input).includes(true)) return { ok: false, error: 'Aguarde confirmação de ambas as bombas desligadas.' }
    if (mode === 'automatic') {
      if (!Object.values(input).includes(false) || Object.values(input).includes(true)) {
        return { ok: false, error: 'Desative o automático antes de ligar manualmente.' }
      }
      next.pump1 = next.pump2 = false
      mode = 'manual'
    }
    state = next
    revision++
    if (!baselineConfirmed) baselineRevision = revision
    return { ok: true, value: get() }
  }

  return { get, set, control, register, setMode, acknowledgeTrip, observeBaseline, tripAck: () => tripAck }
}
