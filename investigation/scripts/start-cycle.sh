#!/system/bin/sh
set -eu
test "$(wc -c < /data/local/tmp/treadmill-start.bin)" -eq 16
test "$(wc -c < /data/local/tmp/treadmill-pause.bin)" -eq 16
nohup sh -c 'sleep 45; cat /data/local/tmp/treadmill-pause.bin > /dev/ttyAS2; echo fallback-pause-sent' > /data/local/tmp/treadmill-cycle-watchdog.log 2>&1 < /dev/null &
echo $! > /data/local/tmp/treadmill-cycle-watchdog.pid
cat /data/local/tmp/treadmill-start.bin > /dev/ttyAS2
echo start-sent
