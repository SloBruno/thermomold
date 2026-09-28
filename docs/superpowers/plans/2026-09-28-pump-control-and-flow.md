# Pump Control and Flow Sensor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manual on/off control of two pumps (HW-383 relays) from the public site, plus ZJ-S201 flow telemetry, with fail-safe pump shutdown on the ESP32.

**Architecture:** The site POSTs the desired pump state to the Render backend (`/api/pumps`). The backend keeps the desired state in memory (default: both off) and returns it in the response to every ESP32 telemetry POST. The ESP32 applies it on GPIO19/GPIO33, reports the actual relay state and the flow reading in the next telemetry, and turns both pumps off if it has no successful backend response for 3 s, loses Wi-Fi, or reboots.

**Tech Stack:** ESP32 Arduino (PlatformIO, Unity native tests), Express + Socket.IO (node:test), React + Vite.

**Spec:** Design approved in chat on 2026-09-28 (manual on/off only, no PWM, public control without password, fail-safe = off).

## Global Constraints

- Pump 1 = relay IN1 = GPIO19; Pump 2 = relay IN2 = GPIO33.
- Flow sensor ZJ-S201 signal = GPIO34 through a 10 kΩ / 20 kΩ divider.
- Relay logic is active-high by default and configurable by one constant (`kRelayActiveLevel`).
- Pumps default OFF on backend start and ESP32 boot.
- ESP32 command timeout: 3000 ms without a successful telemetry response → both pumps OFF.
- Telemetry interval stays 500 ms.
- Flow conversion: `L/min = pulses_per_second / 7.5` (YF-S201-family constant); the constant is named so it can be calibrated.
- Backward compatible: telemetry without `sensors.flow` or `pumps` is still accepted.
- No secrets in the repository.

## File Structure

- `server/src/pumps.ts` (new): pump desired-state store and validation.
- `server/src/telemetry.ts`: accept optional `sensors.flow` and `pumps`.
- `server/src/index.ts`: `GET/POST /api/pumps`, commands in telemetry response, Socket.IO broadcast.
- `server/test/pumps.test.ts` (new), `server/test/telemetry.test.ts`.
- `firmware/include/actuators.h` (new): pure helpers (flow conversion, fail-safe timeout, command parsing).
- `firmware/include/telemetry_contract.h`: payload builder with flow and pump state.
- `firmware/src/main.cpp`: relay outputs, flow ISR, command handling.
- `client/src/pages/PumpControlPage.tsx` (new), `client/src/App.tsx`, `client/src/pages/RealSensorPage.tsx`.
- `hardware/README.md` (new): wiring text + KiCad files.

### Task 1: Backend pump store and API
- [ ] Test: store starts `{pump1:false,pump2:false}`; `set` accepts booleans and rejects non-booleans/unknown keys.
- [ ] Implement `createPumpStore()` with `get()` and `set(input)`.
- [ ] Wire `GET/POST /api/pumps`; include `commands.pumps` in the `POST /api/telemetry` response; emit `pumps:data`.

### Task 2: Backend telemetry accepts flow and actual pump state
- [ ] Test: payload with `sensors.flow {sensor:'ZJ-S201', litersPerMinute, totalLiters}` and `pumps {pump1,pump2}` normalizes; negative flow rejected.
- [ ] Implement in `normalizeTelemetry`.

### Task 3: Firmware pure helpers
- [ ] Test: `flowLitersPerMinute(15 pulses, 1000 ms) == 2.0`; zero interval → 0.
- [ ] Test: `pumpsCommandExpired(last, now, 3000)`.
- [ ] Test: `parsePumpCommand` reads `"pump1":true,"pump2":false` from the response body; missing/garbled → both off.
- [ ] Test: payload builder appends `flow` and `pumps`.

### Task 4: Firmware integration
- [ ] Relay pins configured as outputs at inactive level before Wi-Fi provisioning.
- [ ] Flow ISR on GPIO34 (FALLING), window-based L/min, cumulative liters.
- [ ] Apply command after each successful POST; fail-safe off on timeout or Wi-Fi loss.
- [ ] Build `esp32dev`.

### Task 5: Site
- [ ] `PumpControlPage`: two cards with desired state, confirmed state from telemetry, Ligar/Desligar buttons.
- [ ] Nav entry "Bombas"; Sensor Real shows flow (L/min, total L).
- [ ] `npm run build`.

### Task 6: Hardware README
- [ ] `hardware/README.md` with the approved wiring text and links to the KiCad/PDF/PNG files.
