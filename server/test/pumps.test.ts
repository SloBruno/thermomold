import assert from 'node:assert/strict'
import test from 'node:test'
import { createPumpStore } from '../src/pumps.ts'

function confirm(p: ReturnType<typeof createPumpStore>, boot = 'boot') {
  p.register(boot); const c = p.control(); p.observeBaseline(boot, { ...c, tripGeneration: p.tripAck() }, { pump1: false, pump2: false })
}

test('pump store starts with both pumps off', () => {
  assert.deepEqual(createPumpStore().get(), { pump1: false, pump2: false })
})

test('pump store updates only the pumps that were sent', () => {
  const store = createPumpStore()
  confirm(store)
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

test('registration requires observed off baseline', () => {
  const store = createPumpStore()
  store.register('boot')
  assert.equal(store.set({ pump1: true }).ok, false)
})

test('baseline requires matching boot, authority, revision, generation and both actual relays OFF', () => {
  const p = createPumpStore(); p.register('boot'); const c = p.control()
  const report = { ...c, tripGeneration: 0 }
  for (const [boot, feedback, actual] of [
    ['other', report, { pump1: false, pump2: false }],
    ['boot', { ...report, session: 'old' }, { pump1: false, pump2: false }],
    ['boot', { ...report, revision: c.revision - 1 }, { pump1: false, pump2: false }],
    ['boot', { ...report, tripGeneration: undefined }, { pump1: false, pump2: false }],
    ['boot', report, { pump1: true, pump2: false }],
    ['boot', report, undefined],
  ] as const) {
    p.observeBaseline(boot, feedback, actual)
    assert.equal(p.set({ pump1: true }).ok, false)
    assert.equal(p.setMode({ mode: 'automatic', session: c.session, revision: c.revision }).ok, false)
  }
  p.observeBaseline('boot', report, { pump1: false, pump2: false })
  assert.equal(p.set({ pump1: true }).ok, true)
  p.acknowledgeTrip('boot', 1)
  p.observeBaseline('boot', report, { pump1: false, pump2: false })
  assert.equal(p.set({ pump1: true }).ok, false)
  const off = p.control()
  p.observeBaseline('boot', { ...off, tripGeneration: 1 }, { pump1: false, pump2: false })
  assert.equal(p.set({ pump1: true }).ok, true)
})
