"""Capture ESP32 serial to a file until a marker line or timeout. Resets the board via RTS first.
usage: capture.py <out> <seconds> [stop_marker] [--no-reset]
Redacts lines that look like they carry credentials."""
import re, sys, time
import serial

out, secs = sys.argv[1], float(sys.argv[2])
marker = sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith('--') else None
reset = '--no-reset' not in sys.argv
SECRET = re.compile(r'(pass|psk|key|token|secret|authorization|bearer)\s*[:=]?\s*\S+', re.I)

s = serial.Serial('/dev/ttyUSB0', 115200, timeout=0.5)
if reset:
    s.dtr = False; s.rts = True; time.sleep(0.2); s.rts = False
end = time.time() + secs
buf = b''
with open(out, 'w') as f:
    while time.time() < end:
        buf += s.read(4096)
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            text = line.decode('utf-8', 'replace').rstrip('\r')
            text = SECRET.sub(lambda m: m.group(1) + '=[REDACTED]', text)
            f.write(text + '\n'); f.flush()
            if not text.startswith('R,'):
                print(text, flush=True)
            if marker and marker in text:
                end = 0
s.close()
