import { Router } from 'express'
import type { createFlowCalibration } from './flow-calibration.js'

export function flowCalibrationRouter(run: ReturnType<typeof createFlowCalibration>, changed: () => void = () => {}) {
  const router = Router()
  router.use((req, res, next) => {
    if (req.method === 'POST') res.on('finish', () => { if (res.statusCode < 400) changed() })
    next()
  })
  router.get('/', (_req, res) => { run.tick(); res.json(run.get()) })
  router.post('/start', (req, res) => {
    try { res.json(run.start(req.body?.referenceMl)) }
    catch (error) { res.status(409).json({ error: (error as Error).message }) }
  })
  router.post('/heartbeat', (req, res) => {
    try { res.json(run.heartbeat(req.body?.id)) }
    catch (error) { res.status(409).json({ error: (error as Error).message }) }
  })
  router.post('/stop', (_req, res) => { res.json(run.stop()) })
  router.post('/abort', (_req, res) => { res.json(run.abort('Coleta cancelada: comando OFF enviado.')) })
  return router
}
