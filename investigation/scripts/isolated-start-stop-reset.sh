#!/system/bin/sh
set -eu
# No preceding Stop or mode initialization. Resume, then Stop after countdown.
trap 'cat /data/local/tmp/treadmill-stop.bin > /dev/ttyAS2' EXIT HUP INT TERM
nohup sh -c 'sleep 7; cat /data/local/tmp/treadmill-stop.bin > /dev/ttyAS2' >/data/local/tmp/isolated-reset-watchdog.log 2>&1 </dev/null &
cat /data/local/tmp/treadmill-start.bin > /dev/ttyAS2
sleep 4
cat /data/local/tmp/treadmill-stop.bin > /dev/ttyAS2
echo resume-then-stop-sent
