import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import test from 'node:test'

async function port(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const value = (probe.address() as { port: number }).port
  probe.close()
  await once(probe, 'close')
  return value
}

async function start(portNumber: number, file: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(portNumber), TELEMETRY_DEVICE_KEY: 'test-device-key', CALIBRATION_FILE: file },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start')), 5000)
    child.stdout?.on('data', chunk => {
      if (chunk.toString().includes(`Server running on port ${portNumber}`)) { clearTimeout(timeout); resolve() }
    })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`server exited: ${code}`)))
  })
  return child
}

test('public calibration API revisions and authenticated telemetry command delivery', async t => {
  const file = `/tmp/thermomold-calibration-${process.pid}-${Date.now()}.json`
  const portNumber = await port()
  const child = await start(portNumber, file)
  t.after(async () => { child.kill('SIGTERM'); await once(child, 'exit'); await unlink(file).catch(() => {}) })
  const base = `http://127.0.0.1:${portNumber}`

  const initial = await fetch(`${base}/api/calibration`)
  assert.equal(initial.status, 200)
  assert.equal((await initial.json()).revision, 0)

  const update = await fetch(`${base}/api/calibration`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sensors: {
      'max6675-1': { low: { rawC: 20, referenceC: 21 }, high: { rawC: 100, referenceC: 101 } },
      'max6675-2': { low: { rawC: 20, referenceC: 19 }, high: { rawC: 100, referenceC: 99 } },
    } }),
  })
  assert.equal(update.status, 200)
  assert.equal((await update.json()).revision, 1)

  const telemetry = { deviceId: 'esp32-01', temperatureC: 20, sensor: 'MAX6675', sensors: {
    thermocouples: [{ id: 'max6675-1', temperatureC: 20 }, { id: 'max6675-2', temperatureC: 20 }],
  } }
  const unauthenticated = await fetch(`${base}/api/telemetry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(telemetry) })
  assert.equal(unauthenticated.status, 401)
  const authenticated = await fetch(`${base}/api/telemetry`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Device-Key': 'test-device-key' }, body: JSON.stringify(telemetry) })
  assert.equal(authenticated.status, 202)
  assert.equal((await authenticated.json()).commands.calibration.revision, 1)
})
