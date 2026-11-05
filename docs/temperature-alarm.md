# Real thermocouple alarm (firmware 0.1.16)

- Uses `abs(calibrated T1 − calibrated T2)` in the independent ESP32 control task, acquiring a new pair no sooner than 250 ms after the preceding read. HTTP/OTA does not own acquisition. No actuator rules changed.
- `<=3 °C`: normal/clear. `>3 °C` for at least 2000 ms of continuous new samples: warning/yellow. `>5 °C`: severe/red on that acquisition (no persistence delay).
- Severe falling into `(3,5]` becomes warning if the current continuous `>3` interval is already 2 s old; otherwise pending. Invalid pair or an acquisition gap greater than 750 ms produces unknown and resets persistence. Calibration changes also reset evidence.
- Telemetry carries optional `temperatureAlarm: {state, deltaC}` and running `firmwareVersion`; legacy payloads remain accepted but their alarm is not confirmed. Failed sends rebuild from the current snapshot on retry, not from a cached alarm.
- Sensor Real and the routed Dashboard (`SimpleDashboardPage`) each mount one alarm. Simulator has none. No browser-side 2 s threshold inference. Offline/stale/failure is not normal; cached browser data also expires after 15 s.
- Sound requires **Ativar som** on each page. Warning: one sine beep every 3 s; severe: three square beeps every 1.2 s. **Silenciar** stops sound only. Browser blocking is shown visibly; audibility/autoplay and physical sensor behavior are not claimed from mocks.
- Browser delivery is the next successful telemetry snapshot: normally 2500 ms after the preceding POST finishes, plus network duration, then polling/socket delivery. It is not instantaneous; brief between-report transitions are not an event history. Offline retry backoff remains 2–60 s.

## Offline verification

62 native PlatformIO tests; four Python harnesses (actual acquisition/control, local fill control, loop scheduling, actual report serialization); 42 backend tests; 14 client tests, including mocked AudioContext waveform calls and rendered real-page/simulator isolation. Backend/client builds and ESP32 release build pass. Vite retains its existing >500 kB bundle warning.

`server/public/ota/thermomold.bin` is the actual compiled 0.1.16 artifact; manifest SHA-256: `1301424673775dc7353743acac74f85f6f8f045b725fabec6c136ef4edf0d782`.

Local files only: no push, deployment, flash, USB access, or actuator command. Independent review and operator-led browser/hardware validation remain pending.
