#!/system/bin/sh
# Short, bounded handoff of the serial port. No control/key commands are sent.
set -eu
port=/dev/ttyAS2
poll=/data/local/tmp/treadmill-serial-poll.bin
capture=/data/local/tmp/treadmill-serial-capture.bin
pid=$(pidof com.bodi.treadmill)
case "$pid" in ''|*[!0-9]*) echo 'Expected one treadmill app PID' >&2; exit 1;; esac
[ -r "$poll" ] && [ -r "$port" ] && [ -w "$port" ]
[ "$(wc -c < "$poll" | tr -d ' ')" = 16 ]
# Defend against accidental replay of a setting/key packet.
pollhex=$(od -An -tx1 "$poll" | tr -d ' \n')
[ "$pollhex" = fd0100000000000000000000010002fe ] || { echo 'Only verified idle poll allowed' >&2; exit 1; }
reader=''
cleanup() {
  kill -CONT "$pid" 2>/dev/null || true
  if [ -n "$reader" ]; then kill "$reader" 2>/dev/null || true; fi
}
trap cleanup EXIT HUP INT TERM
# Independent bounded restoration if this shell fails before its cleanup trap.
(sleep 4; kill -CONT "$pid" 2>/dev/null || true) </dev/null >/dev/null 2>&1 &
echo "Temporarily suspending app PID $pid; exchanging ten idle polls"
kill -STOP "$pid"
timeout 2.5 cat "$port" > "$capture" &
reader=$!
i=0
while [ "$i" -lt 10 ]; do
  cat "$poll" > "$port"
  sleep 0.2
  i=$((i + 1))
done
wait "$reader" || true
reader=''
kill -CONT "$pid"
echo "App restored; raw response bytes: $(wc -c < "$capture")"
