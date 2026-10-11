#!/system/bin/sh
# User-authorized brief start followed by full stop; no setting changes.
set -eu
start=/data/local/tmp/treadmill-start.bin
stop=/data/local/tmp/treadmill-stop.bin
test "$(wc -c < "$start")" -eq 16
test "$(wc -c < "$stop")" -eq 16
trap 'cat /data/local/tmp/treadmill-stop.bin > /dev/ttyAS2' EXIT HUP INT TERM
nohup sh -c 'sleep 5; cat /data/local/tmp/treadmill-stop.bin > /dev/ttyAS2; echo fallback-stop-sent' > /data/local/tmp/start-stop-reset-watchdog.log 2>&1 < /dev/null &
cat "$start" > /dev/ttyAS2
sleep 0.3
cat "$stop" > /dev/ttyAS2
echo start-then-stop-sent
