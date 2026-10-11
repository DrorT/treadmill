param(
    [string]$Device = '192.168.10.18:41765',
    [string]$Adb = 'C:\Program Files\ASUS\GlideX\adb.exe'
)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    $appPid = (& $Adb -s $Device shell -T pidof com.bodi.treadmill).Trim()
    if ($LASTEXITCODE -ne 0 -or $appPid -notmatch '^\d+$') { throw 'Cannot resolve treadmill app PID' }
    & $Adb -s $Device forward tcp:8700 "jdwp:$appPid"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot forward debugger connection' }
    node scripts/inspect-serial-buffers.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Could not validate idle poll frame' }
    & $Adb -s $Device push serial/serial-poll.bin /data/local/tmp/treadmill-serial-poll.bin
    if ($LASTEXITCODE -ne 0) { throw 'Poll upload failed' }
    & $Adb -s $Device push scripts/standalone-serial-probe.sh /data/local/tmp/standalone-serial-probe.sh
    if ($LASTEXITCODE -ne 0) { throw 'Probe upload failed' }
    node scripts/poll-live.mjs 1 telemetry/before-serial-probe.jsonl
    if ($LASTEXITCODE -ne 0) { throw 'Could not confirm paused state' }
    $state = Get-Content -LiteralPath telemetry/live-telemetry-latest.json -Raw | ConvertFrom-Json
    if ($state.state -ne 'Paused' -or $state.statusRaw -ne 7) { throw 'Probe requires paused treadmill' }
    & $Adb -s $Device shell -T sh /data/local/tmp/standalone-serial-probe.sh
    if ($LASTEXITCODE -ne 0) { throw 'Standalone probe failed; device restoration trap/watchdog remains responsible for cleanup' }
    & $Adb -s $Device pull /data/local/tmp/treadmill-serial-capture.bin (Join-Path (Split-Path -Parent $PSScriptRoot) 'serial/serial-standalone-capture.bin')
    if ($LASTEXITCODE -ne 0) { throw 'Capture download failed' }
    node scripts/decode-serial.mjs serial/serial-standalone-capture.bin
    if ($LASTEXITCODE -ne 0) { throw 'No valid controller replies' }
    node scripts/poll-live.mjs 2 telemetry/after-serial-probe.jsonl
    if ($LASTEXITCODE -ne 0) { throw 'Could not read restored app state' }
    $after = Get-Content -LiteralPath telemetry/live-telemetry-latest.json -Raw | ConvertFrom-Json
    if ($after.state -ne 'Paused' -or $after.statusRaw -ne 7) { throw 'Restored app does not report Paused' }
    if ($after.speed -ne $state.speed -or $after.inclineRaw -ne $state.inclineRaw -or $after.elapsedSeconds -ne $state.elapsedSeconds -or $after.distance -ne $state.distance) { throw 'Session changed during idle serial probe' }
} finally {
    Pop-Location
}
