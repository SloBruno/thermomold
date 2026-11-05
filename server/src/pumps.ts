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
  const control = () => ({ ...state, mode, session, revision, deviceSession })
  function register(boot: string) {
    if (boot === deviceSession) return
    deviceSession = boot
    mode = 'manual'; state = { pump1: false, pump2: false }; revision++
  }
  function setMode(input: unknown) {
    const value = input as { mode?: unknown; session?: unknown; revision?: unknown } | null
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(k => !['mode', 'session', 'revision'].includes(k))
      || !['manual', 'automatic'].includes(value.mode as string)) return { ok: false as const, error: 'modo inválido' }
    if (value.mode === 'automatic' && (!deviceSession || value.session !== session || value.revision !== revision)) {
      return { ok: false as const, error: 'Estado expirado ou firmware incompatível; atualize e habilite intencionalmente.' }
    }
    mode = value.mode as 'manual' | 'automatic'
    state = { pump1: false, pump2: false }; revision++
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

    if (mode === 'automatic') {
      if (!Object.values(input).includes(false) || Object.values(input).includes(true)) {
        return { ok: false, error: 'Desative o automático antes de ligar manualmente.' }
      }
      next.pump1 = next.pump2 = false
      mode = 'manual'
    }
    state = next
    revision++
    return { ok: true, value: get() }
  }

  return { get, set, control, register, setMode }
}
