import assert from 'node:assert/strict'
import test from 'node:test'
import { createPumpStore } from '../src/pumps.ts'
import { normalizeTelemetry } from '../src/telemetry.ts'

test('automatic enable requires registered device and current server revision; manual OFF cancels it', () => {
  const p = createPumpStore()
  assert.equal(p.control().mode, 'manual')
  assert.equal(p.setMode({ mode: 'automatic', session: p.control().session, revision: 0 }).ok, false)
  p.register('device-boot-1')
  const c = p.control()
  assert.equal(p.setMode({ mode: 'automatic', session: c.session, revision: c.revision }).ok, true)
  assert.equal(p.control().mode, 'automatic')
  assert.deepEqual(p.get(), { pump1: false, pump2: false })
  assert.equal(p.set({ pump1: true }).ok, false)
  assert.equal(p.set({ pump2: false }).ok, true)
  assert.equal(p.control().mode, 'manual')
  assert.deepEqual(p.get(), { pump1: false, pump2: false })
  assert.equal(p.setMode({ mode: 'automatic', session: c.session, revision: c.revision }).ok, false)
})

test('backend restart and device reboot discard authority; invalid mode/feedback cannot change it', () => {
  const p=createPumpStore();p.register('b1')
  const first=p.control()
  p.setMode({mode:'automatic',session:first.session,revision:first.revision})
  for(const input of [null,[],{}, {mode:'AUTO'}, {mode:'manual',extra:true}, {mode:'automatic',session:first.session,revision:'1'}]) {
    const before=p.control();assert.equal(p.setMode(input).ok,false);assert.deepEqual(p.control(),before)
  }
  p.register('b2');assert.equal(p.control().mode,'manual')
  const restart=createPumpStore();restart.register('b2')
  assert.notEqual(restart.control().session,first.session)
  assert.equal(restart.setMode({mode:'automatic',session:first.session,revision:first.revision}).ok,false)
  const good={deviceSession:'b1',mode:'manual',session:'',revision:0}
  assert.equal(normalizeTelemetry({deviceId:'fake',temperatureC:20,control:good}).ok,true)
  for(const control of [null,[], {...good,revision:-1}, {...good,revision:1.5}, {...good,revision:4294967296}, {...good,mode:'AUTO'}, {...good,deviceSession:''}]) {
    assert.equal(normalizeTelemetry({deviceId:'fake',temperatureC:20,control}).ok,false)
  }
})
