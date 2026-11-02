export interface FlowCalibrationState {
  id?: string
  phase: 'idle' | 'collecting' | 'stopping' | 'complete' | 'failed'
  referenceMl: number
  startedAt?: number
  stoppedAt?: number
  elapsedMs?: number
  sampleCount: number
  latestFlowLpm?: number
  measuredMl?: number
  pulses?: number
  source?: 'raw-pulses' | 'filtered-total'
  proposedFactor?: number
  proposedPulsesPerLiter?: number
  baselineObservedAt?: string
  finalObservedAt?: string
  error?: string
  applied: false
}
