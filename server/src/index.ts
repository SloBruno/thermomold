import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import type { SimulatorState, DashboardData, MachineData, MoldLibrary, MoldParameters, SensorParameter } from '../../shared/types';
import { createTelemetryStore, normalizeTelemetry } from './telemetry.js';

const CP_WATER = 4.18;
const MOLD_TARGET_TEMP = 80;
const EXPECTED_HEAT_LOAD = 18;
const REF_FLOW = 9;

const app = express();
app.use(express.json());

const clientOrigins = process.env.CLIENT_ORIGIN
  ?.split(',')
  .map(origin => origin.trim())
  .filter(Boolean) ?? ['http://localhost:5173'];
app.use(cors({ origin: clientOrigins }));

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: clientOrigins,
  },
});

const PORT = Number(process.env.PORT ?? 3001);
const configuredStaleAfterMs = Number(process.env.TELEMETRY_STALE_MS ?? 30_000);
const telemetryStaleAfterMs = Number.isFinite(configuredStaleAfterMs) && configuredStaleAfterMs > 0
  ? configuredStaleAfterMs
  : 30_000;
const telemetryDeviceKey = process.env.TELEMETRY_DEVICE_KEY;
const telemetryStore = createTelemetryStore(telemetryStaleAfterMs);

let state: SimulatorState = {
  ambientTemp: 25,
  centralPumpSpeed: 70,
  machines: [
    { id: '1', name: 'Máquina 1', enabled: false, pumpSpeed: 50, obstruction: false, lowPressureFault: false, hotTowerWater: false },
    { id: '2', name: 'Máquina 2', enabled: false, pumpSpeed: 50, obstruction: false, lowPressureFault: false, hotTowerWater: false },
    { id: '3', name: 'Máquina 3', enabled: false, pumpSpeed: 50, obstruction: false, lowPressureFault: false, hotTowerWater: false },
  ],
};

let simpleState: SimulatorState = {
  ambientTemp: 25,
  centralPumpSpeed: 70,
  machines: [
    { id: '1', name: 'Unidade Simplificada', enabled: true, pumpSpeed: 50, obstruction: false, lowPressureFault: false, hotTowerWater: false, simpleFaults: [] },
  ],
};

const DEFAULT_MOLD_PARAMETERS: MoldParameters = {
  id: 'default',
  name: 'Molde Padrão',
  targetTemp: MOLD_TARGET_TEMP,
  tempIn: { target: 29, tolerance: 3 },
  tempOut: { target: 57.5, tolerance: 7.5 },
  pressure: { target: 2.75, tolerance: 0.75 },
  flow: { target: 12.5, tolerance: 3.5 },
  deltaT: { target: 21, tolerance: 9 },
  heatExchange: { target: 20, tolerance: 2 },
};

let simpleMolds: MoldParameters[] = [DEFAULT_MOLD_PARAMETERS];
let activeSimpleMoldId = DEFAULT_MOLD_PARAMETERS.id;

const BASE_PRESSURE = 3.0;
const MACHINE_COUNT_PENALTY = 0.3;
const BASE_SUPPLY_TEMP = 28;
const AMBIENT_SUPPLY_INFLUENCE = 0.4;
const MIN_SUPPLY_TEMP = 10;
const MAX_SUPPLY_TEMP = 50;
const SIMPLE_IDLE_PRESSURE = 0.3;
const SIMPLE_PRESSURE_COEFFICIENT = 4.15;
const OBSTRUCTION_FLOW_REDUCTION = 0.4;
const INLET_BLOCKED_FLOW_REDUCTION = 0.72;
const CHANNEL_BLOCKED_FLOW_REDUCTION = 0.55;
const RETURN_HOSE_KINKED_FLOW_REDUCTION = 0.78;
const CHANNEL_DAMAGED_FLOW_REDUCTION = 0.25;
const LOW_PRESSURE_REDUCTION = 0.5;
const HOT_WATER_EXTRA = 15;
const IDEAL_FLOW_MIN = 7;
const IDEAL_FLOW_MAX = 13;
const SIMPLE_IDEAL_FLOW_MIN = 9;
const SIMPLE_IDEAL_FLOW_MAX = 16;
const IDEAL_TEMP_IN_MAX = 32;
const IDEAL_TEMP_OUT_MIN = 50;
const IDEAL_TEMP_OUT_MAX = 65;
const IDEAL_DELTA_T_MAX = 30;
const IDEAL_HEAT_REMOVED_MIN = 18;
const IDEAL_HEAT_REMOVED_MAX = 22;
const MIN_IDEAL_PRESSURE = 1.5;
const CRIT_FLOW = 4;
const CRIT_PRESS = 0.8;
const CENTRAL_MAX_FLOW = 60;

function normalizeSensorParameter(
  payload: Partial<SensorParameter> | undefined,
  fallback: SensorParameter,
  min: number,
  max: number,
  maxTolerance: number,
): SensorParameter {
  const target = Number(payload?.target);
  const tolerance = Number(payload?.tolerance);

  return {
    target: Number.isFinite(target) ? Math.min(max, Math.max(min, target)) : fallback.target,
    tolerance: Number.isFinite(tolerance) ? Math.min(maxTolerance, Math.max(0.1, tolerance)) : fallback.tolerance,
  };
}

function normalizeMoldParameters(payload: Partial<MoldParameters>, fallback = DEFAULT_MOLD_PARAMETERS): MoldParameters {
  const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 50) : '';
  const targetTemp = Number(payload.targetTemp);
  const id = typeof payload.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(payload.id) ? payload.id : fallback.id;

  return {
    id,
    name: name || 'Molde Padrão',
    targetTemp: Number.isFinite(targetTemp) ? Math.min(120, Math.max(50, targetTemp)) : MOLD_TARGET_TEMP,
    tempIn: normalizeSensorParameter(payload.tempIn, fallback.tempIn, 5, 60, 20),
    tempOut: normalizeSensorParameter(payload.tempOut, fallback.tempOut, 10, 100, 30),
    pressure: normalizeSensorParameter(payload.pressure, fallback.pressure, 0.2, 8, 4),
    flow: normalizeSensorParameter(payload.flow, fallback.flow, 0.5, 40, 20),
    deltaT: normalizeSensorParameter(payload.deltaT, fallback.deltaT, 1, 80, 30),
    heatExchange: normalizeSensorParameter(payload.heatExchange, fallback.heatExchange, 0.5, 60, 30),
  };
}

function getActiveSimpleMold(): MoldParameters {
  return simpleMolds.find(mold => mold.id === activeSimpleMoldId) ?? DEFAULT_MOLD_PARAMETERS;
}

function getMoldLibrary(): MoldLibrary {
  return { molds: simpleMolds, activeMoldId: activeSimpleMoldId };
}

function range(parameter: SensorParameter): { min: number; max: number } {
  return { min: parameter.target - parameter.tolerance, max: parameter.target + parameter.tolerance };
}

function broadcastSimpleMoldUpdate(): void {
  io.emit('simple:molds:data', getMoldLibrary());
  io.emit('simple:dashboard:data', calculateDashboardData(simpleState, getActiveSimpleMold()));
}

function calculateDashboardData(state: SimulatorState, moldParameters?: MoldParameters): DashboardData {
  const { ambientTemp, centralPumpSpeed = 70, machines } = state;
  const enabledCount = machines.filter(m => m.enabled).length;
  const centralFactor = centralPumpSpeed / 100;
  const activeMold = moldParameters ?? DEFAULT_MOLD_PARAMETERS;
  const moldTargetTemp = activeMold.targetTemp;
  const tempInRange = range(activeMold.tempIn);
  const tempOutRange = range(activeMold.tempOut);
  const pressureRange = range(activeMold.pressure);
  const flowRange = range(activeMold.flow);
  const deltaTRange = range(activeMold.deltaT);
  const heatExchangeRange = range(activeMold.heatExchange);

  const Q_central = CENTRAL_MAX_FLOW * centralFactor;
  const Q_ramal = enabledCount > 0 ? Q_central / enabledCount : 0;

  const idealCentralPct = 25 * enabledCount;

  const basePressure = Math.max(0.5, (BASE_PRESSURE - ((enabledCount - 1) * MACHINE_COUNT_PENALTY)) * centralFactor);

  const machinesData: MachineData[] = machines.map(machine => {
    if (!machine.enabled) {
      return {
        id: machine.id,
        name: machine.name,
        enabled: false,
        tempIn: 0,
        tempOut: 0,
        deltaT: 0,
        flow: 0,
        flowIn: 0,
        flowOut: 0,
        heatRemoved: 0,
        pressure: 0,
        pressureIn: 0,
        pressureOut: 0,
        pumpSpeed: 0,
        status: 'normal',
        alert: 'Máquina desligada.',
      };
    }

    let tempIn = BASE_SUPPLY_TEMP + ((ambientTemp - 25) * AMBIENT_SUPPLY_INFLUENCE);
    if (machine.hotTowerWater) {
      tempIn += HOT_WATER_EXTRA;
    }
    tempIn = Math.max(MIN_SUPPLY_TEMP, Math.min(MAX_SUPPLY_TEMP, tempIn));

    const simpleFaults = new Set(machine.simpleFaults ?? []);
    const isSimpleSimulation = machine.simpleFaults !== undefined;

    let pressureIn = basePressure * (1.0 + 0.5 * (machine.pumpSpeed / 100));
    if (isSimpleSimulation) {
      const pumpFactor = machine.pumpSpeed / 100;
      pressureIn = SIMPLE_IDLE_PRESSURE + (SIMPLE_PRESSURE_COEFFICIENT * centralFactor * Math.pow(pumpFactor, 0.35));
    }
    if (isSimpleSimulation) {
      if (simpleFaults.has('lowPressure')) {
        pressureIn *= (1 - LOW_PRESSURE_REDUCTION);
      }
      if (simpleFaults.has('inletBlocked')) {
        pressureIn *= 0.85;
      }
    } else if (machine.lowPressureFault) {
      pressureIn *= (1 - LOW_PRESSURE_REDUCTION);
    }
    pressureIn = Math.max(0.2, pressureIn);

    let flowIn = Q_ramal * (machine.pumpSpeed / 100);
    if (isSimpleSimulation) {
      flowIn = Math.min(25, flowIn);
      if (simpleFaults.has('inletBlocked')) {
        flowIn *= (1 - INLET_BLOCKED_FLOW_REDUCTION);
      }
      if (simpleFaults.has('lowPressure')) {
        flowIn *= 0.65;
      }
    } else if (machine.obstruction) {
      flowIn *= (1 - OBSTRUCTION_FLOW_REDUCTION);
    }
    flowIn = Math.max(0.5, Math.min(25, flowIn));

    let flowOut = flowIn;
    let pressureOut = pressureIn;
    if (isSimpleSimulation) {
      if (simpleFaults.has('channelBlocked')) {
        flowOut *= (1 - CHANNEL_BLOCKED_FLOW_REDUCTION);
        pressureOut -= 0.65;
      }
      if (simpleFaults.has('returnHoseKinked')) {
        flowOut *= (1 - RETURN_HOSE_KINKED_FLOW_REDUCTION);
        pressureOut -= 0.7;
      }
      if (simpleFaults.has('channelDamaged')) {
        flowOut *= (1 - CHANNEL_DAMAGED_FLOW_REDUCTION);
        pressureOut *= 0.65;
      }
      pressureOut -= flowOut * 0.006;
    }
    flowOut = Math.max(0.5, Math.min(25, flowOut));
    pressureOut = Math.max(0.2, pressureOut);

    const effectiveFlow = isSimpleSimulation ? flowOut : flowIn;
    let effectiveness = 0.6 * Math.pow(REF_FLOW / effectiveFlow, 0.4);
    if (simpleFaults.has('channelBlocked')) {
      effectiveness *= 0.5;
    }
    if (simpleFaults.has('channelDamaged')) {
      effectiveness *= 0.55;
    }
    if (machine.hotTowerWater || simpleFaults.has('highTemp')) {
      effectiveness *= 0.55;
    }
    effectiveness = Math.max(0.15, Math.min(0.95, effectiveness));

    let deltaT = (moldTargetTemp - tempIn) * effectiveness;
    deltaT = Math.max(1, deltaT);

    let tempOut = tempIn + deltaT;

    let pressureFactor = Math.min(1, pressureOut / Math.max(0.2, pressureRange.min));
    let flowQualityFactor = Math.min(1, effectiveFlow / Math.max(0.5, flowRange.min));
    let deltaTQualityFactor = deltaT > deltaTRange.max ? deltaTRange.max / deltaT : 1;
    let heatRemoved = effectiveFlow * deltaT * CP_WATER / 60 * pressureFactor * flowQualityFactor * deltaTQualityFactor;

    const deltaTRounded = Math.round(deltaT * 100) / 100;
    tempOut = Math.round(tempOut * 100) / 100;

    const isCritical = tempOut > tempOutRange.max + 10 || effectiveFlow < Math.max(0.5, flowRange.min * 0.45) || heatRemoved < Math.max(0.5, heatExchangeRange.min * 0.4);
    const isUndercool = heatRemoved < heatExchangeRange.min;
    const isOvercool = heatRemoved > heatExchangeRange.max;
    const isTempInLow = tempIn < tempInRange.min;
    const isTempInHigh = tempIn > tempInRange.max;
    const isTempOutLow = tempOut < tempOutRange.min;
    const isTempOutHigh = tempOut > tempOutRange.max;
    const isDeltaTLow = deltaT < deltaTRange.min;
    const isDeltaTHigh = deltaT > deltaTRange.max;
    const isSimpleFlowOutside = isSimpleSimulation
      ? flowIn < flowRange.min || flowIn > flowRange.max || flowOut < flowRange.min || flowOut > flowRange.max
      : flowIn < flowRange.min || flowIn > flowRange.max;
    const isLowPressure = isSimpleSimulation
      ? pressureIn < pressureRange.min || pressureIn > pressureRange.max || pressureOut < pressureRange.min || pressureOut > pressureRange.max
      : pressureIn < pressureRange.min || pressureIn > pressureRange.max;
    const isCentralInsufficient = enabledCount > 0 && centralPumpSpeed < idealCentralPct;
    const hasActiveSimpleFault = simpleFaults.size > 0;

    let status: 'normal' | 'attention' | 'critical';
    if (isCritical) {
      status = 'critical';
    } else if (isUndercool || isOvercool || isTempInLow || isTempInHigh || isTempOutLow || isTempOutHigh || isDeltaTLow || isDeltaTHigh || isSimpleFlowOutside || isLowPressure || isCentralInsufficient || hasActiveSimpleFault) {
      status = 'attention';
    } else {
      status = 'normal';
    }

    let alert: string;
    if (tempOut > tempOutRange.max + 10) {
      alert = 'Água de retorno quase na temperatura do molde. Vazão insuficiente para resfriar.';
    } else if (effectiveFlow < Math.max(0.5, flowRange.min * 0.45)) {
      alert = 'Vazão crítica. Verificar obstrução ou bomba.';
    } else if (heatRemoved < Math.max(0.5, heatExchangeRange.min * 0.4)) {
      alert = 'Calor removido muito baixo. Risco de superaquecimento do molde.';
    } else if (tempIn > tempInRange.max) {
      alert = 'Temperatura de entrada acima do ideal. Verificar torre de resfriamento.';
    } else if (isSimpleSimulation && (pressureIn < pressureRange.min || pressureOut < pressureRange.min)) {
      alert = 'Pressão abaixo do ideal. Verificar mangueiras e conexões.';
    } else if (tempOut > tempOutRange.max) {
      alert = 'Temperatura de retorno acima do ideal. Aumentar vazão.';
    } else if (effectiveFlow < flowRange.min) {
      alert = 'Vazão abaixo do ideal. Verificar bomba ou possível obstrução.';
    } else if (deltaT > deltaTRange.max) {
      alert = 'Delta T acima do ideal. Aumentar vazão.';
    } else if (tempOut < tempOutRange.min) {
      alert = 'Temperatura de retorno abaixo do ideal. Reduzir vazão.';
    } else if (heatRemoved < heatExchangeRange.min) {
      alert = `Calor removido abaixo do ideal (${heatRemoved.toFixed(1)} kW). Aumentar vazão.`;
    } else if (heatRemoved > heatExchangeRange.max) {
      alert = `Calor removido excessivo (${heatRemoved.toFixed(1)} kW). Risco de resfriamento excessivo. Reduzir vazão.`;
    } else if (isCentralInsufficient) {
      if (centralPumpSpeed < idealCentralPct * 0.75) {
        alert = `Bomba central muito baixa (${centralPumpSpeed}%) para ${enabledCount} máquinas. Aumentar bomba central.`;
      } else {
        alert = `Bomba central abaixo do ideal (${centralPumpSpeed}%) para ${enabledCount} máquinas (ideal: ${idealCentralPct}%).`;
      }
    } else if (machine.obstruction) {
      alert = 'Possível obstrução no circuito. Verificar vazão reduzida.';
    } else if (effectiveFlow > flowRange.max) {
      alert = 'Reduzir bomba da máquina: risco de resfriamento excessivo do molde.';
    } else if (pressureIn < pressureRange.min) {
      alert = 'Pressão abaixo do ideal. Verificar bomba ou aumentar velocidade.';
    } else if (machine.hotTowerWater) {
      alert = 'Temperatura de entrada elevada. Verificar condição da torre de resfriamento.';
    } else if (tempOut > 68) {
      alert = 'Temperatura de saída subindo. Monitorar refrigeração.';
    } else {
      alert = 'Refrigeração dentro da faixa esperada.';
    }

    return {
      id: machine.id,
      name: moldParameters?.name ?? machine.name,
      enabled: true,
      tempIn: Math.round(tempIn * 100) / 100,
      tempOut,
      deltaT: deltaTRounded,
      flow: Math.round(effectiveFlow * 100) / 100,
      flowIn: Math.round(flowIn * 100) / 100,
      flowOut: Math.round(flowOut * 100) / 100,
      heatRemoved: Math.round(heatRemoved * 100) / 100,
      pressure: Math.round(pressureOut * 100) / 100,
      pressureIn: Math.round(pressureIn * 100) / 100,
      pressureOut: Math.round(pressureOut * 100) / 100,
      pumpSpeed: machine.pumpSpeed,
      status,
      alert,
      simpleFaults: machine.simpleFaults,
    };
  });

  return {
    timestamp: new Date().toISOString(),
    machines: machinesData,
  };
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.emit('telemetry:data', telemetryStore.getStatus());

  const data = calculateDashboardData(state);
  socket.emit('dashboard:data', data);

  socket.on('simulator:state', (payload: SimulatorState) => {
    console.log('State update received:', JSON.stringify(payload));
    state = payload;
    const dashboardData = calculateDashboardData(state);
    console.log('Dashboard data:', JSON.stringify(dashboardData));
    io.emit('dashboard:data', dashboardData);
  });

  socket.on('dashboard:request', () => {
    const data = calculateDashboardData(state);
    socket.emit('dashboard:data', data);
  });

  socket.emit('simple:molds:data', getMoldLibrary());
  const simpleData = calculateDashboardData(simpleState, getActiveSimpleMold());
  socket.emit('simple:dashboard:data', simpleData);

  socket.on('simple:simulator:state', (payload: SimulatorState) => {
    console.log('Simple state update:', JSON.stringify(payload));
    simpleState = payload;
    const dashboardData = calculateDashboardData(simpleState, getActiveSimpleMold());
    io.emit('simple:dashboard:data', dashboardData);
  });

  socket.on('simple:dashboard:request', () => {
    const data = calculateDashboardData(simpleState, getActiveSimpleMold());
    socket.emit('simple:dashboard:data', data);
  });

  socket.on('simple:molds:request', () => {
    socket.emit('simple:molds:data', getMoldLibrary());
  });

  socket.on('simple:molds:save', (payload: Partial<MoldParameters>) => {
    const existing = simpleMolds.find(mold => mold.id === payload.id);
    const fallback = existing ?? DEFAULT_MOLD_PARAMETERS;
    const normalized = normalizeMoldParameters(payload, fallback);

    if (existing) {
      simpleMolds = simpleMolds.map(mold => mold.id === normalized.id ? normalized : mold);
    } else {
      simpleMolds = [...simpleMolds, normalized];
    }
    activeSimpleMoldId = normalized.id;
    broadcastSimpleMoldUpdate();
  });

  socket.on('simple:molds:activate', (moldId: string) => {
    if (simpleMolds.some(mold => mold.id === moldId)) {
      activeSimpleMoldId = moldId;
      broadcastSimpleMoldUpdate();
    }
  });

  socket.on('simple:molds:delete', (moldId: string) => {
    if (moldId === DEFAULT_MOLD_PARAMETERS.id || !simpleMolds.some(mold => mold.id === moldId)) return;

    simpleMolds = simpleMolds.filter(mold => mold.id !== moldId);
    if (activeSimpleMoldId === moldId) activeSimpleMoldId = simpleMolds[0].id;
    broadcastSimpleMoldUpdate();
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', state });
});

app.get('/api/telemetry', (_req, res) => {
  res.json(telemetryStore.getStatus());
});

app.post('/api/telemetry', (req, res) => {
  if (telemetryDeviceKey && req.get('X-Device-Key') !== telemetryDeviceKey) {
    res.status(401).json({ error: 'não autorizado' });
    return;
  }

  const normalized = normalizeTelemetry(req.body);
  if (!normalized.ok) {
    res.status(400).json({ error: normalized.error });
    return;
  }

  const sample = telemetryStore.save(normalized.value);
  const status = telemetryStore.getStatus();
  io.emit('telemetry:data', status);
  res.status(202).json({ accepted: true, sample });
});

app.post('/simulate', (req, res) => {
  const simState = req.body as SimulatorState;
  state = simState;
  const data = calculateDashboardData(state);
  res.json(data);
});

app.post('/simulate-simple', (req, res) => {
  const simState = req.body as SimulatorState;
  simpleState = simState;
  const data = calculateDashboardData(simpleState, getActiveSimpleMold());
  res.json(data);
});

app.get('/simple-mold-parameters', (_req, res) => {
  res.json(getActiveSimpleMold());
});

app.post('/simple-mold-parameters', (req, res) => {
  const activeMold = getActiveSimpleMold();
  const normalized = normalizeMoldParameters({ ...req.body, id: activeMold.id } as Partial<MoldParameters>, activeMold);
  simpleMolds = simpleMolds.map(mold => mold.id === normalized.id ? normalized : mold);
  broadcastSimpleMoldUpdate();
  res.json(normalized);
});

app.get('/simple-molds', (_req, res) => {
  res.json(getMoldLibrary());
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
