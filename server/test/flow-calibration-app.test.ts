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
  assert.equal((await post('/api/flow-calibration/start', { referenceMl: 500 })).status, 200)
  assert.deepEqual((await (await post('/api/telemetry', sample)).json()).commands.pumps, { pump1: true, pump2: true })
  assert.equal((await post('/api/pumps', { pump1: true })).status, 409)
  assert.deepEqual(await (await post('/api/pumps', { pump1: false })).json(), { pump1: false, pump2: false })
  assert.equal((await (await fetch(base + '/api/flow-calibration')).json()).phase, 'failed')
  assert.deepEqual((await (await post('/api/telemetry', sample)).json()).commands.pumps, { pump1: false, pump2: false })
  // Capable firmware registers a volatile boot/session; legacy payloads remain manual.
  const capable = { ...sample, control: { deviceSession: 'boot-1', mode: 'manual', session: '', revision: 0 } }
  let command = (await (await post('/api/telemetry', capable)).json()).commands.pumps
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
})
