#!/system/bin/sh
# Caller must confirm Paused immediately before invoking this script.
set -eu
app_pid=$(pidof com.bodi.treadmill)
case "$app_pid" in ''|*[!0-9]*) echo 'Expected one app PID' >&2; exit 1;; esac
source_dir=/data/user/0/com.bodi.treadmill/databases
snapshot_dir=$(mktemp -d /data/local/tmp/treadmill-history.XXXXXX)
cleanup() { kill -CONT "$app_pid" 2>/dev/null || true; }
trap cleanup EXIT HUP INT TERM
# Independent restore if the copying shell fails. Copying normally takes far less.
(sleep 4; kill -CONT "$app_pid" 2>/dev/null || true) </dev/null >/dev/null 2>&1 &
kill -STOP "$app_pid"
cp "$source_dir/treadmill" "$snapshot_dir/treadmill"
for suffix in -wal -shm; do
  if [ -f "$source_dir/treadmill$suffix" ]; then
    cp "$source_dir/treadmill$suffix" "$snapshot_dir/treadmill$suffix"
  fi
done
kill -CONT "$app_pid"
echo "$snapshot_dir"
