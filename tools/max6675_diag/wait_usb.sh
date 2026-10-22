#!/bin/bash
# Wait up to 25 min for /dev/ttyUSB0 to be present and stable for 15 s
# (no USB disconnect lines in journalctl -k). Exit 0 = stable, 2 = flapping, 1 = timeout.
deadline=$(( $(date +%s) + 25*60 ))
flaps=0
while [ $(date +%s) -lt $deadline ]; do
  if [ -e /dev/ttyUSB0 ]; then
    since=$(date '+%Y-%m-%d %H:%M:%S')
    sleep 15
    disc=$(journalctl -k --since "$since" --no-pager 2>/dev/null | grep -ciE "usb .*disconnect|cp210x.*disconnected|ttyUSB0.*disconnected")
    if [ -e /dev/ttyUSB0 ] && [ "$disc" -eq 0 ]; then
      echo "STABLE at $(date '+%T')"; journalctl -k --since "-2min" --no-pager | grep -iE "usb|cp210|ttyUSB" | tail -8
      exit 0
    fi
    flaps=$((flaps+1)); echo "unstable window ($disc disconnects) flaps=$flaps at $(date '+%T')"
    journalctl -k --since "$since" --no-pager | grep -iE "disconnect|cp210" | tail -5
    if [ $flaps -ge 3 ]; then echo "FLAPPING"; exit 2; fi
  else
    sleep 2
  fi
done
echo TIMEOUT; exit 1
