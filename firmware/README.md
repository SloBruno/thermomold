# ThermoMold ESP32 MAX6675 telemetry

PlatformIO/Arduino firmware for an ESP32 connected to a MAX6675 K-type thermocouple module. It submits this exact payload to the configured `/api/telemetry` URL:

```json
{"deviceId":"press-01","temperatureC":123.45,"sensor":"MAX6675"}
```

`observedAt` is intentionally omitted: the server assigns its observation time. The `X-Device-Key` request header is sent only when `deviceKey` is configured.

## Wiring defaults

| MAX6675 pin | ESP32 GPIO |
| --- | ---: |
| SCK / CLK | 18 |
| CS | 5 |
| SO / DO | 19 |
| VCC | 3.3V |
| GND | GND |

The firmware uses software SPI so all three GPIO pins can be changed without rebuilding. MAX6675 only measures non-negative Celsius temperatures.

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
- `Telemetry endpoint` (an HTTP URL), including `/api/telemetry`
- optional `Device key`
- optional MAX6675 GPIO values and report interval (minimum 1000 ms)

After it joins Wi-Fi, these non-Wi-Fi values are stored in LittleFS at `/config.json`. To force portal configuration again, erase the ESP32 flash or use WiFiManager's reset operation from a local maintenance build.

### Optional local config file

For repeatable setup, copy `data/config.example.json` to `data/config.json`, fill it locally, then upload LittleFS data with `platformio run -e esp32dev -t uploadfs`. `data/config.json` is gitignored. Do not commit a real endpoint, device key, Wi-Fi credential, or local address.

## Runtime behavior

- MAX6675 read status and `NaN` values are rejected and never reported.
- Wi-Fi reconnection is attempted every 10 seconds while disconnected.
- Failed non-2xx telemetry posts are retained and retried with exponential backoff from 2 to 60 seconds.
- Normal measurement/reporting is every 30 seconds by default and configurable through the portal or local config.
- The device key is not sent at all when it is blank.

Run the host-side payload contract test with `platformio test -e native`.
