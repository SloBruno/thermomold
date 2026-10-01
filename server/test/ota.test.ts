import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import test from 'node:test'

async function findAvailablePort(): Promise<number> {
  const probe = createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const address = probe.address()
  if (!address || typeof address === 'string') throw new Error('could not allocate a test port')
  const { port } = address
  probe.close()
  await once(probe, 'close')
  return port
}

async function startServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      TELEMETRY_DEVICE_KEY: 'test-device-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const started = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start')), 5_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(`Server running on port ${port}`)) {
        clearTimeout(timeout)
        resolve()
      }
    })
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timeout)
      reject(new Error(`server exited before starting with code ${code}`))
    })
  })

  await started
  return child
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await once(child, 'exit')
}

test('OTA manifest requires the configured device key', async t => {
  const port = await findAvailablePort()
  const server = await startServer(port)
  t.after(() => stopServer(server))

  const url = `http://127.0.0.1:${port}/api/ota/manifest`
  const missingKey = await fetch(url)
  assert.equal(missingKey.status, 401)

  const wrongKey = await fetch(url, { headers: { 'X-Device-Key': 'wrong-test-key' } })
  assert.equal(wrongKey.status, 401)

  const authorized = await fetch(url, { headers: { 'X-Device-Key': 'test-device-key' } })
  assert.equal(authorized.status, 200)
  assert.deepEqual(await authorized.json(), {
    version: '0.1.0',
    url: 'https://thermomold.onrender.com/ota/thermomold.bin',
    sha256: '7e509987b1b13ba2e8333c227c23b719aaced945cf2fa542585917f1e00af3ad',
  })
})

test('serves OTA public files under the /ota path', async t => {
  const port = await findAvailablePort()
  const server = await startServer(port)
  t.after(() => stopServer(server))

  const response = await fetch(`http://127.0.0.1:${port}/ota/manifest.json`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    version: '0.1.0',
    url: 'https://thermomold.onrender.com/ota/thermomold.bin',
    sha256: '7e509987b1b13ba2e8333c227c23b719aaced945cf2fa542585917f1e00af3ad',
  })
})
