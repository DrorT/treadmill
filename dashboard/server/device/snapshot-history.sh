#!/system/bin/sh
# Bounded read-only snapshot of the treadmill database and its matching WAL/SHM.
set -eu
source_dir=/data/user/0/com.bodi.treadmill/databases
snapshot_dir=$(mktemp -d /data/local/tmp/treadmill-dashboard/history.XXXXXX)
app_pid=$(pidof com.bodi.treadmill)
case "$app_pid" in ''|*[!0-9]*) echo 'Expected one treadmill app PID' >&2; exit 1;; esac
[ -r "$source_dir/treadmill" ] || { echo 'Workout database unavailable' >&2; exit 1; }
restore() { kill -CONT "$app_pid" 2>/dev/null || true; }
trap restore EXIT HUP INT TERM
(sleep 4; kill -CONT "$app_pid" 2>/dev/null || true) </dev/null >/dev/null 2>&1 &
started=$(date +%s)
kill -STOP "$app_pid"
if ! timeout 3 sh -c 'cp "$1/treadmill" "$2/treadmill" && for suffix in -wal -shm; do if [ -f "$1/treadmill$suffix" ]; then cp "$1/treadmill$suffix" "$2/treadmill$suffix"; fi; done' sh "$source_dir" "$snapshot_dir"; then
  restore
  echo 'Database snapshot exceeded its bounded copy time' >&2
  exit 1
fi
restore
ended=$(date +%s)
[ $((ended-started)) -le 3 ] || { echo 'Database snapshot exceeded restoration deadline' >&2; exit 1; }
[ -s "$snapshot_dir/treadmill" ] || { echo 'Database snapshot is empty' >&2; exit 1; }
echo "$snapshot_dir"
