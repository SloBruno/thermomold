import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export type CalibrationPoint = { rawC: number; referenceC: number }
export type SensorCalibration = { low: CalibrationPoint; high: CalibrationPoint }
export type CalibrationSensors = {
  'max6675-1': SensorCalibration
  'max6675-2': SensorCalibration
}
export type CalibrationCommand = { revision: number; sensors: CalibrationSensors }

const IDENTITY: SensorCalibration = { low: { rawC: 0, referenceC: 0 }, high: { rawC: 100, referenceC: 100 } }

export function defaultCalibrationCommand(): CalibrationCommand {
  return { revision: 0, sensors: { 'max6675-1': structuredClone(IDENTITY), 'max6675-2': structuredClone(IDENTITY) } }
}

function isPoint(value: unknown): value is CalibrationPoint {
  if (typeof value !== 'object' || value === null) return false
  const point = value as CalibrationPoint
  return Number.isFinite(point.rawC) && Number.isFinite(point.referenceC)
    && point.rawC >= -200 && point.rawC <= 1350
    && point.referenceC >= -200 && point.referenceC <= 1350
}

function isSensorCalibration(value: unknown): value is SensorCalibration {
  if (typeof value !== 'object' || value === null) return false
  const calibration = value as SensorCalibration
  return isPoint(calibration.low) && isPoint(calibration.high) && calibration.low.rawC !== calibration.high.rawC
}

export function validateCalibrationCommand(value: unknown): { ok: true; value: CalibrationCommand } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null) return { ok: false, error: 'calibração inválida' }
  const input = value as Partial<CalibrationCommand>
  const sensors = input.sensors as Partial<CalibrationSensors> | undefined
  if (!sensors || !isSensorCalibration(sensors['max6675-1']) || !isSensorCalibration(sensors['max6675-2'])) {
    return { ok: false, error: 'os dois sensores precisam de dois pontos com rawC e referenceC válidos' }
  }
  const revision = input.revision === undefined ? 0 : input.revision
  if (!Number.isInteger(revision) || revision < 0) return { ok: false, error: 'revision inválida' }
  return {
    ok: true,
    value: {
      revision,
      sensors: {
        'max6675-1': sensors['max6675-1'],
        'max6675-2': sensors['max6675-2'],
      },
    },
  }
}

export function applyCalibration(rawC: number, calibration: SensorCalibration): number {
  const { low, high } = calibration
  const slope = (high.referenceC - low.referenceC) / (high.rawC - low.rawC)
  return low.referenceC + (rawC - low.rawC) * slope
}

type Persistence = { read: () => unknown | null; write: (value: CalibrationCommand) => void }

export function createFileCalibrationPersistence(path: string): Persistence {
  return {
    read: () => {
      if (!existsSync(path)) return null
      try { return JSON.parse(readFileSync(path, 'utf8')) as unknown } catch { return null }
    },
    write: value => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'),
  }
}

export function createCalibrationStore(persistence: Persistence): {
  get: () => CalibrationCommand
  update: (input: unknown) => { ok: true; value: CalibrationCommand } | { ok: false; error: string }
} {
  const loaded = validateCalibrationCommand(persistence.read())
  let current = loaded.ok ? loaded.value : defaultCalibrationCommand()

  return {
    get: () => current,
    update: input => {
      const validated = validateCalibrationCommand(input)
      if (!validated.ok) return validated
      current = { ...validated.value, revision: current.revision + 1 }
      persistence.write(current)
      return { ok: true, value: current }
    },
  }
}
