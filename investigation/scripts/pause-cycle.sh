#!/system/bin/sh
set -eu
sleep 30
cat /data/local/tmp/treadmill-pause.bin > /dev/ttyAS2
echo pause-sent
