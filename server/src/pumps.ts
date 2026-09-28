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

    state = next
    return { ok: true, value: get() }
  }

  return { get, set }
}
