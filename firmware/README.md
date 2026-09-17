# ThermoMold ESP32 multi-sensor telemetry

PlatformIO/Arduino firmware for an ESP32 connected to two MAX6675 K-type thermocouple modules and one AJ-SR04M ultrasonic level sensor. It keeps the legacy fields and sends all readings in `sensors` to the configured `/api/telemetry` URL:

```json
{"deviceId":"press-01","temperatureC":123.45,"sensor":"MAX6675","sensors":{"thermocouples":[{"id":"max6675-1","temperatureC":123.45},{"id":"max6675-2","temperatureC":126.5}],"level":{"sensor":"AJ-SR04M","distanceMm":350}}}
```

`observedAt` is intentionally omitted: the server assigns its observation time. The `X-Device-Key` request header is sent only when `deviceKey` is configured.

## Wiring defaults

| Sensor | Signal | ESP32 GPIO |
| --- | --- | ---: |
| MAX6675 #1 | SCK / CLK | 32 |
| MAX6675 #1 | CS | 21 |
| MAX6675 #1 | SO / DO | 27 |
| MAX6675 #2 | SCK / CLK | 18 |
| MAX6675 #2 | CS | 23 |
| MAX6675 #2 | SO / DO | 22 |
| AJ-SR04M (R19 open, pulse mode) | RX / TRIG | 25 (output) |
| AJ-SR04M (R19 open, pulse mode) | TX / ECHO | 26 (input) |
| All modules | VCC | 3.3V |
| All modules | GND | GND |

The MAX6675 buses are software SPI and are deliberately fixed to this wiring. The AJ-SR04M is triggered with a 10 µs pulse and its round-trip echo is converted to millimetres using 0.343 mm/µs. MAX6675 only measures non-negative Celsius temperatures.

## Build and upload

1. Install PlatformIO Core or PlatformIO IDE.
2. From this `firmware/` directory, build with `platformio run -e esp32dev`.
3. Connect the ESP32 over USB and upload with `platformio run -e esp32dev -t upload`.
4. Monitor startup/configuration logs with `platformio device monitor -b 115200`.

The board target is the generic `esp32dev`; set `upload_port` locally in `platformio.ini` or pass PlatformIO's upload-port option if auto-discovery does not find the board.

## First-time provisioning

On first boot, the ESP32 starts the `ThermoMold-Setup` captive portal. Connect to that access point, open the portal page, and enter:

- Wi-Fi network and password (stored by WiFiManager in ESP32 flash, never in this repository)
- `Device ID`
- `Telemetry endpoint`: `https://thermomold.onrender.com/api/telemetry` (HTTPS obrigatório)
- optional `Device key`
- report interval (shown for reference; firmware publishes every 500 ms)

After it joins Wi-Fi, these non-Wi-Fi values are stored in LittleFS at `/config.json`. To force portal configuration again, erase the ESP32 flash or use WiFiManager's reset operation from a local maintenance build.

### Optional local config file

For repeatable setup, copy `data/config.example.json` to `data/config.json`, fill it locally, then upload LittleFS data with `platformio run -e esp32dev -t uploadfs`. `data/config.json` is gitignored. Do not commit a real endpoint, device key, Wi-Fi credential, or local address.

## Runtime behavior

- Either MAX6675 error/invalid temperature or an AJ-SR04M echo timeout discards the complete sample; no partial telemetry is posted.
- Wi-Fi reconnection is attempted every 10 seconds while disconnected.
- Failed non-2xx telemetry posts are retained and retried with exponential backoff from 2 to 60 seconds.
- Normal measurement/reporting is every 30 seconds by default and configurable through the portal or local config.
- The device key is not sent at all when it is blank.

Run the host-side payload contract test with `platformio test -e native`.
