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
