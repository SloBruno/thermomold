import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCalibration,
  createCalibrationStore,
  defaultCalibrationCommand,
  validateCalibrationCommand,
} from '../src/calibration.ts'

const point = (rawC: number, referenceC: number) => ({ rawC, referenceC })

test('applies a two-point correction independently', () => {
  assert.equal(applyCalibration(25, { low: point(20, 21), high: point(100, 101) }), 26)
  assert.equal(applyCalibration(60, { low: point(20, 21), high: point(100, 101) }), 61)
})

test('rejects non-finite and duplicate raw calibration points', () => {
  const command = defaultCalibrationCommand()
  assert.equal(validateCalibrationCommand({
    ...command,
    sensors: { ...command.sensors, 'max6675-1': { low: point(20, 21), high: point(20, 22) } },
  }).ok, false)
  assert.equal(validateCalibrationCommand({
    ...command,
    sensors: { ...command.sensors, 'max6675-2': { low: point(Number.NaN, 21), high: point(100, 101) } },
  }).ok, false)
})

test('persists a valid command and increments revision', () => {
  const writes: string[] = []
  const store = createCalibrationStore({
    read: () => null,
    write: value => writes.push(JSON.stringify(value)),
  })
  const first = store.update({
    sensors: {
      'max6675-1': { low: point(20, 21), high: point(100, 101) },
      'max6675-2': { low: point(25, 24), high: point(100, 99) },
    },
  })
  assert.equal(first.ok, true)
  if (first.ok) {
    assert.equal(first.value.revision, 1)
    assert.equal(store.get().revision, 1)
  }
  assert.equal(writes.length, 1)
})
