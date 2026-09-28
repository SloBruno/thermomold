import assert from 'node:assert/strict'
import test from 'node:test'
import { createPumpStore } from '../src/pumps.ts'

test('pump store starts with both pumps off', () => {
  assert.deepEqual(createPumpStore().get(), { pump1: false, pump2: false })
})

test('pump store updates only the pumps that were sent', () => {
  const store = createPumpStore()
  assert.deepEqual(store.set({ pump1: true }), { ok: true, value: { pump1: true, pump2: false } })
  assert.deepEqual(store.set({ pump2: true }), { ok: true, value: { pump1: true, pump2: true } })
  assert.deepEqual(store.set({ pump1: false }), { ok: true, value: { pump1: false, pump2: true } })
})

test('pump store rejects non-boolean values and unknown pumps without changing state', () => {
  const store = createPumpStore()
  assert.deepEqual(store.set({ pump1: 'on' }), { ok: false, error: 'pump1 deve ser true ou false' })
  assert.deepEqual(store.set({ pump3: true }), { ok: false, error: 'bomba desconhecida: pump3' })
  assert.deepEqual(store.set(null), { ok: false, error: 'comando de bombas inválido' })
  assert.deepEqual(store.get(), { pump1: false, pump2: false })
})
