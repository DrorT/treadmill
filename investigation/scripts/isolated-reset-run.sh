#!/system/bin/sh
set -eu
nohup sh -c 'sleep 90; cat /data/local/tmp/treadmill-pause.bin > /dev/ttyAS2' >/data/local/tmp/isolated-run-watchdog.log 2>&1 </dev/null &
cat /data/local/tmp/treadmill-start.bin > /dev/ttyAS2
echo start-sent
