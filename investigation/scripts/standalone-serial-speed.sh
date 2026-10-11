#!/system/bin/sh
# Bounded paused experiment: set speed to 1.0 km/h, retaining incline 1.
set -eu
port=/dev/ttyAS2
poll=/data/local/tmp/treadmill-serial-poll.bin
setting=/data/local/tmp/treadmill-serial-speed.bin
capture=/data/local/tmp/treadmill-serial-speed-capture.bin
pid=$(pidof com.bodi.treadmill)
case "$pid" in ''|*[!0-9]*) echo 'Expected one treadmill app PID' >&2; exit 1;; esac
[ -r "$poll" ] && [ -r "$setting" ] && [ -r "$port" ] && [ -w "$port" ]
pollhex=$(od -An -tx1 "$poll" | tr -d ' \n')
settinghex=$(od -An -tx1 "$setting" | tr -d ' \n')
[ "$pollhex" = fd0100000000000000000000010002fe ] || { echo 'Invalid idle poll' >&2; exit 1; }
[ "$settinghex" = fd01010a010000000000000001000efe ] || { echo 'Only reviewed 1 km/h, incline 1 setting allowed' >&2; exit 1; }
reader=''
cleanup() {
  if [ -n "$reader" ]; then kill "$reader" 2>/dev/null || true; fi
  kill -CONT "$pid" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM
(sleep 4; kill -CONT "$pid" 2>/dev/null || true) </dev/null >/dev/null 2>&1 &
echo "Temporarily suspending app PID $pid; sending one speed setting, with idle polls"
kill -STOP "$pid"
timeout 2.5 cat "$port" > "$capture" &
reader=$!
i=0
while [ "$i" -lt 10 ]; do
  if [ "$i" -eq 1 ]; then
    cat "$setting" > "$port"
  else
    cat "$poll" > "$port"
  fi
  sleep 0.2
  i=$((i + 1))
done
wait "$reader" || true
reader=''
kill -CONT "$pid"
echo "App restored; raw response bytes: $(wc -c < "$capture")"
