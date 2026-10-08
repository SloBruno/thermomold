# Two-Point MAX6675 Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public two-point calibration for both MAX6675 sensors, persist and revise the server command, deliver authenticated commands to the ESP32, persist them in LittleFS, and publish raw/corrected telemetry with a public calibration wizard.

**Architecture:** A shared calibration contract defines two points per sensor and a linear correction function. The server owns the public calibration command and revision, persists it in a small JSON file, validates updates, and includes the current command only in authenticated telemetry responses. The firmware stores the highest accepted revision in its existing LittleFS config, applies correction locally, and sends raw/corrected values plus revision. The client consumes the public GET/POST calibration API through a wizard route.

**Tech Stack:** Node.js/TypeScript, Express, Node test runner, React/Vite/Tailwind, Arduino ESP32/ArduinoJson/LittleFS, PlatformIO Unity native tests.

**Spec:** Approved two-point calibration requirements from the user task.

## Global Constraints

- Both MAX6675 sensors are calibrated independently with two reference points.
- A calibration command is public to read/update but is delivered to the ESP32 only after authenticated telemetry.
- Server revisions are monotonic and the ESP32 never applies an older revision.
- Device configuration remains in LittleFS `/config.json`.
- Telemetry preserves raw readings and includes corrected readings and applied calibration revision.
- Existing legacy telemetry fields and pump/level/flow behavior remain backward compatible.
- No destructive changes to existing user worktree changes; no push; commit locally.

### Task 1: Define and validate the calibration contract

**Files:**
- Create: `server/src/calibration.ts`
- Test: `server/test/calibration.test.ts`
- Modify: `server/src/telemetry.ts`, `server/test/telemetry.test.ts`

- [ ] Write failing tests for two-point validation, linear interpolation/extrapolation, monotonic revisions, persisted server state, and telemetry raw/corrected/revision normalization.
- [ ] Run `npm test -- --test-name-pattern calibration` from `server/` and confirm expected failures.
- [ ] Implement the smallest typed calibration store and telemetry normalization changes.
- [ ] Run the focused tests and then the complete server test suite.

### Task 2: Add authenticated server command delivery and public API

**Files:**
- Modify: `server/src/index.ts`
- Test: `server/test/calibration-api.test.ts`
- Modify: `server/.env.example`

- [ ] Write failing route tests for public GET/POST calibration, validation errors, revision increments, authenticated command delivery, and rejection of unauthenticated telemetry.
- [ ] Run the focused route tests and confirm failures.
- [ ] Implement file-backed calibration command persistence, `GET/POST /api/calibration`, and `commands.calibration` in authenticated telemetry responses only.
- [ ] Run the complete server test suite.

### Task 3: Implement firmware calibration persistence and corrected telemetry

**Files:**
- Modify: `firmware/include/actuators.h` or create `firmware/include/calibration.h`
- Modify: `firmware/include/telemetry_contract.h`
- Modify: `firmware/src/main.cpp`
- Modify: `firmware/test/test_telemetry_contract/test_telemetry_contract.cpp`
- Modify: `firmware/data/config.example.json`

- [ ] Write failing native tests for linear correction, invalid/older command rejection, persisted command serialization, and raw/corrected/revision payload shape.
- [ ] Run `pio test -e native` and confirm failures.
- [ ] Implement calibration helpers, LittleFS load/save, authenticated response parsing/application, and corrected telemetry generation.
- [ ] Run native firmware tests and the firmware build.

### Task 4: Build the public calibration wizard

**Files:**
- Create: `client/src/pages/CalibrationPage.tsx`
- Modify: `client/src/App.tsx`, `client/src/pages/RealSensorPage.tsx`
- Test: `client/src/pages/CalibrationPage.test.tsx` or repository-compatible client tests

- [ ] Add failing client tests for loading both sensors, entering two reference points, validation, submit, revision display, and raw/corrected preview.
- [ ] Run the client test command and confirm failures.
- [ ] Implement the public wizard and link it from navigation; show current raw/corrected values and revision on the real sensor page.
- [ ] Run client typecheck/build and the focused client tests.

### Task 5: Document, verify, and commit

**Files:**
- Modify: `README.md`, `firmware/README.md`

- [ ] Document the calibration formula, public wizard/API, authenticated delivery, LittleFS persistence, revision behavior, telemetry fields, and bench procedure.
- [ ] Run all server tests, client build, firmware native tests, firmware build, and inspect the final diff.
- [ ] Commit locally with `feat: add public two-point MAX6675 calibration`.
