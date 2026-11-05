export interface MachineState {
  id: string;
  name: string;
  enabled: boolean;
  pumpSpeed: number;
  obstruction: boolean;
  lowPressureFault: boolean;
  hotTowerWater: boolean;
  simpleFaults?: string[];
}

export interface SimulatorState {
  ambientTemp: number;
  centralPumpSpeed: number;
  machines: MachineState[];
}

export interface MoldParameters {
  id: string;
  name: string;
  targetTemp: number;
  tempIn: SensorParameter;
  tempOut: SensorParameter;
  pressure: SensorParameter;
  flow: SensorParameter;
  deltaT: SensorParameter;
  heatExchange: SensorParameter;
}

export interface SensorParameter {
  target: number;
  tolerance: number;
}

export interface MoldLibrary {
  molds: MoldParameters[];
  activeMoldId: string;
}

export interface MachineData {
  id: string;
  name: string;
  enabled: boolean;
  tempIn: number;
  tempOut: number;
  deltaT: number;
  flow: number;
  heatRemoved: number;
  pressure: number;
  pressureIn: number;
  pressureOut: number;
  pumpSpeed: number;
  flowIn: number;
  flowOut: number;
  status: "normal" | "attention" | "critical";
  alert: string;
  simpleFaults?: string[];
}

export interface DashboardData {
  timestamp: string;
  machines: MachineData[];
}

// Explicit null means this acquisition is unavailable, never a numeric sentinel
// or a cached previous value. Legacy top-level temperature always mirrors #1.
export type TemperatureC = number | null;
export interface ThermocoupleReading {
  id: 'max6675-1' | 'max6675-2';
  rawTemperatureC?: TemperatureC;
  temperatureC: TemperatureC;
}
export interface LevelReading { sensor: 'AJ-SR04M'; distanceMm: number }
export interface FlowReading { sensor: 'ZJ-S201'; litersPerMinute: number; totalLiters: number; rawTotalPulses?: number; counterEpoch?: string; pulsesPerLiter?: number }
export interface MultiSensorReadings {
  thermocouples: [ThermocoupleReading, ThermocoupleReading];
  level?: LevelReading;
  flow?: FlowReading;
}
export interface FillingFeedback { deviceSession: string; mode: 'manual' | 'automatic'; session: string; revision: number }
export interface TelemetrySample {
  control?: FillingFeedback;
  deviceId: string;
  temperatureC: TemperatureC;
  rawTemperatureC?: TemperatureC;
  calibrationRevision?: number;
  observedAt: string;
  sensor: 'MAX6675';
  sensors?: MultiSensorReadings;
  pumps?: { pump1: boolean; pump2: boolean };
  diagnostics?: { max6675Status: [number, number]; max6675Raw?: [number, number]; levelRawMm?: number[] };
  receivedAt: string;
}
export type TelemetryStatus =
  | { connected: false; status: 'offline'; stale: true; sample: null }
  | { connected: true; status: 'online' | 'stale'; stale: boolean; sample: TelemetrySample };
