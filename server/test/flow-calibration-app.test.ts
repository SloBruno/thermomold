import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import test from 'node:test'

test('app sends both commands to fake ESP and manual OFF invalidates calibration', async t => {
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as { port: number }).port
  probe.close(); await once(probe, 'close')
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), TELEMETRY_DEVICE_KEY: 'test-only-key' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => { child.kill(); await once(child, 'exit') })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('startup timeout')), 5000)
    child.stdout!.on('data', chunk => { if (chunk.toString().includes('Server running')) { clearTimeout(timer); resolve() } })
    child.once('error', reject)
  })
  const base = `http://127.0.0.1:${port}`
  const post = (path: string, body: object) => fetch(base + path, { method: 'POST', headers: {
    'content-type': 'application/json', 'X-Device-Key': 'test-only-key',
  }, body: JSON.stringify(body) })
  const sample = { deviceId: 'fake-esp', temperatureC: 20, pumps: { pump1: false, pump2: false },
    sensors: { thermocouples: [{ id: 'max6675-1', temperatureC: 20 }, { id: 'max6675-2', temperatureC: 20 }],
      flow: { sensor: 'ZJ-S201', totalLiters: 0, litersPerMinute: 0 } } }
  assert.equal((await post('/api/telemetry', sample)).status, 202)
  assert.equal((await post('/api/flow-calibration/start', { referenceMl: 500 })).status, 409)
  // 0.1.16-style session without trip generation must never confirm a baseline.
  const legacy = { ...sample, control: { deviceSession: 'legacy-boot', requestNonce: 'legacy-1', mode: 'manual', session: '', revision: 0 } }
  const legacyOff = (await (await post('/api/telemetry', legacy)).json()).commands.pumps
  await post('/api/telemetry', { ...legacy, control: { ...legacy.control, session: legacyOff.session, revision: legacyOff.revision } })
  assert.equal((await post('/api/pumps', { pump1: true })).status, 400)
  assert.equal((await (await post('/api/telemetry', legacy)).json()).commands.pumps.pump1, false)
  const capable = { ...sample, control: { deviceSession: 'boot-1', requestNonce: 'request-1', mode: 'manual', session: '', revision: 0, tripGeneration: 0 } }
  let command = (await (await post('/api/telemetry', capable)).json()).commands.pumps
  assert.equal((await post('/api/pumps', { pump1: true })).status, 400)
  // Lost response: repeat the old request; server must keep offering OFF.
  const retry = (await (await post('/api/telemetry', capable)).json()).commands.pumps
  assert.equal(retry.revision, command.revision); assert.equal(retry.pump1, false)
  const ackSample = { ...capable, control: { ...capable.control, session: command.session, revision: command.revision } }
  await post('/api/telemetry', ackSample)
  assert.equal((await post('/api/flow-calibration/start', { referenceMl: 500 })).status, 200)
  assert.equal((await (await post('/api/telemetry', ackSample)).json()).commands.pumps.pump1, true)
  assert.equal((await post('/api/pumps', { pump1: true })).status, 409)
  assert.equal((await post('/api/pumps', { pump1: false })).status, 200)
  assert.equal((await (await fetch(base + '/api/flow-calibration')).json()).phase, 'failed')
  assert.equal((await post('/api/telemetry', { ...capable, control: { ...capable.control, requestNonce: '' } })).status, 400)
  assert.equal(command.mode, 'manual')
  let view = await (await fetch(base + '/api/filling')).json()
  assert.equal((await post('/api/filling', { mode: 'automatic', session: view.session, revision: view.revision })).status, 200)
  command = (await (await post('/api/telemetry', capable)).json()).commands.pumps
  assert.equal(command.mode, 'automatic')
  assert.equal((await post('/api/flow-calibration/start', { referenceMl: 500 })).status, 409)
  assert.equal((await post('/api/pumps', { pump1: false })).status, 200)
  assert.equal((await (await fetch(base + '/api/filling')).json()).mode, 'manual')
  view = await (await fetch(base + '/api/filling')).json()
  await post('/api/filling', { mode: 'automatic', session: view.session, revision: view.revision })
  const newBoot = { ...capable, control: { ...capable.control, deviceSession: 'boot-2' } }
  command = (await (await post('/api/telemetry', newBoot)).json()).commands.pumps
  assert.equal(command.mode, 'manual')
  assert.equal(command.deviceSession, 'boot-2')
  assert.equal((await post('/api/filling', { mode: 'automatic', session: view.session, revision: view.revision })).status, 409)
  // Trip is acknowledged only with a fresh OFF command, and duplicate feedback
  // must not erase an intentional command issued after that baseline.
  await post('/api/telemetry', { ...newBoot, control: { ...newBoot.control, session: command.session, revision: command.revision } })
  await post('/api/pumps', { pump1: true })
  const tripped = { ...newBoot, control: { ...newBoot.control, session: command.session,
    revision: command.revision, requestNonce: 'trip-1', tripGeneration: 1 } }
  const ack = (await (await post('/api/telemetry', tripped)).json()).commands.pumps
  assert.equal(ack.tripAck, 1); assert.equal(ack.mode, 'manual'); assert.equal(ack.pump1, false)
  assert.equal(ack.deviceSession, 'boot-2'); assert.equal(ack.requestNonce, 'trip-1')
  assert.equal((await post('/api/pumps', { pump1: true })).status, 400)
  await post('/api/telemetry', { ...tripped, control: { ...tripped.control, revision: ack.revision } })
  await post('/api/pumps', { pump1: true })
  const duplicate = (await (await post('/api/telemetry', tripped)).json()).commands.pumps
  assert.equal(duplicate.pump1, true); assert.ok(duplicate.revision > ack.revision)
  const old = (await (await post('/api/telemetry', { ...capable, control: { ...capable.control, tripGeneration: 3 } })).json()).commands.pumps
  assert.equal(old.deviceSession, 'boot-2'); assert.equal(old.pump1, true)
})
