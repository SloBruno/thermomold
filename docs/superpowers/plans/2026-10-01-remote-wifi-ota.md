# Remote Wi-Fi OTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an already-provisioned ThermoMold ESP32 to securely fetch and install a new firmware binary from the Render backend over the internet, without USB or Bluetooth.

**Architecture:** The repository carries a versioned ESP32 binary and SHA-256 manifest under `server/public/ota/`. Render serves the binary and returns the manifest only to a device authenticated with `X-Device-Key`. The ESP32 polls the manifest, verifies a TLS certificate and SHA-256 of the download, then installs only a newer version.

**Tech Stack:** ESP32 Arduino/PlatformIO, WiFiClientSecure, Update.h, ArduinoJson, Express/TypeScript, Node test runner, SHA-256.

**Spec:** `README.md` and this plan.

## Global Constraints

- OTA must work over the internet; it must not require the computer and ESP32 to share a LAN.
- OTA manifest requires the existing `X-Device-Key`; never commit or log the key.
- The ESP32 must validate the Render TLS certificate for OTA downloads.
- The ESP32 must verify the binary SHA-256 before installation.
- A device with an empty key, invalid manifest, stale clock, invalid certificate, hash mismatch, or failed download must keep its installed firmware.
- The first OTA-capable firmware still needs one USB upload; subsequent updates use Wi-Fi.
- Keep pumps fail-safe and inactive during all OTA paths.

---

### Task 1: Firmware version and manifest parser

**Files:**
- Create: `firmware/include/ota_update.h`
- Modify: `firmware/test/test_telemetry_contract/test_telemetry_contract.cpp`

**Interfaces:**
- Produces: `bool isNewerFirmwareVersion(const std::string&, const std::string&)`.
- Produces: `OtaManifest parseOtaManifest(const std::string&)` containing `valid`, `version`, `url`, and lowercase `sha256`.

- [ ] **Step 1: Write failing host tests** for newer semantic versions and a malformed/invalid-hash manifest.
- [ ] **Step 2: Run `platformio test -e native`** and confirm the new tests fail because `ota_update.h` is absent.
- [ ] **Step 3: Implement the parser and semantic version comparison** using ArduinoJson; reject non-HTTPS URLs and hashes other than 64 lowercase hexadecimal characters.
- [ ] **Step 4: Run `platformio test -e native`** and confirm all firmware tests pass.
- [ ] **Step 5: Commit the tested parser.**

### Task 2: Backend manifest and binary distribution

**Files:**
- Create: `server/public/ota/manifest.json`
- Modify: `server/src/index.ts`
- Modify: `server/test/telemetry.test.ts` or create `server/test/ota.test.ts`

**Interfaces:**
- `GET /api/ota/manifest` authenticates with `X-Device-Key` and returns `{version,url,sha256}`.
- `/ota/thermomold.bin` serves the immutable binary referenced by the manifest.

- [ ] **Step 1: Write a failing HTTP-level test** asserting missing/wrong device key returns 401 and the correct key returns the manifest.
- [ ] **Step 2: Run the server test** and confirm it fails because no OTA route exists.
- [ ] **Step 3: Implement static binary serving plus authenticated manifest route**; never return the device key.
- [ ] **Step 4: Run all server tests and build.**
- [ ] **Step 5: Commit backend OTA distribution.**

### Task 3: Secure remote update in ESP32 runtime

**Files:**
- Modify: `firmware/src/main.cpp`
- Modify: `firmware/platformio.ini`
- Modify: `firmware/include/ota_update.h`
- Modify: `firmware/test/test_telemetry_contract/test_telemetry_contract.cpp`

**Interfaces:**
- `checkForOtaUpdate()` runs no more often than every 15 minutes after Wi-Fi and config are ready.
- It reads the authenticated manifest, compares version, downloads over TLS, validates SHA-256 and calls `Update.end()` only on success.

- [ ] **Step 1: Add a failing pure-function test** for rejecting a non-newer version.
- [ ] **Step 2: Implement the runtime OTA state machine** with NTP clock synchronization, pinned CA, 15-minute polling and serial-only status messages.
- [ ] **Step 3: Run native tests and `platformio run -e esp32dev`.**
- [ ] **Step 4: Commit the runtime OTA client.**

### Task 4: Package and activate the initial OTA image

**Files:**
- Create: `server/public/ota/thermomold.bin`
- Update: `server/public/ota/manifest.json`
- Modify: `README.md`
- Modify: `firmware/README.md`

**Interfaces:**
- Manifest version equals the firmware build version.
- SHA-256 equals the exact tracked binary.

- [ ] **Step 1: Build the firmware with an explicit release version.**
- [ ] **Step 2: Calculate SHA-256 and create the manifest.**
- [ ] **Step 3: Add README operation instructions and document the one-time USB bootstrap.**
- [ ] **Step 4: Verify manifest hash against the binary, run all tests/builds and `git diff --check`.**
- [ ] **Step 5: Commit, push, wait for Render deployment, then USB-upload the OTA-capable bootstrap firmware.**

### Task 5: Physical verification

**Files:** none beyond logs.

- [ ] **Step 1: Observe serial logs for Wi-Fi connection and OTA manifest check.**
- [ ] **Step 2: Verify the deployed `GET /api/ota/manifest` rejects unauthenticated requests.**
- [ ] **Step 3: Confirm normal telemetry continues after the OTA-capable firmware starts.**

## Self-review

- The plan covers remote reachability, authentication, certificate validation, hash verification, version comparison, deployment assets, USB bootstrap, and physical read-back.
- All security-sensitive inputs remain in Render/ESP local storage and are not added to source control.
- The binary is only installed after validated HTTPS metadata and a matching SHA-256 digest.
