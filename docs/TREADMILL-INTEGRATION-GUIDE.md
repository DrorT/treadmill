# G700X treadmill integration guide

Discovery date: 2026-10-10. Workspace: `D:\dev\treadmill`.

This is the consolidated reference for reconnecting, reading workouts, and controlling this machine. The scripts and captures named below are in this workspace. Commands are examples to run intentionally; writing this guide does not operate the treadmill.

## 1. Device and verified capabilities

| Item | Observed value |
| --- | --- |
| Machine label | Premium G700X / Ultimate Fitness (Peru branding) |
| Console model in Settings | K10.1FHD-N-ENS-AC |
| Firmware displayed | v1.5.5-yjnp |
| Android | 11; build RP1A.201005.006 test-keys |
| Console platform | Allwinner A133; Bluetooth name `quad core a133 b6` |
| Treadmill app | `com.bodi.treadmill`, versionCode 57; also the launcher |
| Installed APK | `/oem/app/app-np-v1.5.5-16/app-np-v1.5.5-16.apk` |
| Access | Wireless ADB; shell is root on this firmware |
| Internal controller link | `/dev/ttyAS2`, UART, 19200 baud, 8N1 |
| Live units | `SerialComm.mUnit = METRIC` |

Confirmed end to end: saved workout extraction; changing live time/distance/speed; remote screen speed selection; direct app speed and incline setters; physical incline change confirmed by the user; independent UART polling; raw UART speed setting; raw start and pause; live pulse readings of 73–82 bpm.

The network connection terminates at the Android console. The hardware UART is inside that console. No direct Bluetooth fitness service or motor-controller Wi-Fi API was established. Normal Bluetooth pairing alone did not provide a usable fitness connection. The USB-A socket was not established as an ADB device connection. Wi-Fi initially failed, then worked after restarting the treadmill.

## 2. Connect or reconnect

### One-time setup on the console

1. Connect the treadmill and laptop to the same reachable Wi-Fi network.
2. Open Android **About tablet**, tap **Build number** repeatedly to enable Developer options.
3. Enable **USB debugging** and **Wireless debugging**; allow debugging on this network.
4. In Wireless debugging, select **Pair device with pairing code**. Record the displayed address, pairing port, and current code.
5. After pairing, use the **IP address & port on the main Wireless debugging page** to connect. This port differs from the pairing port.

We reached About tablet through Android settings exposed from the console's app/permission screens. Typing an Android Settings intent into Chrome performed a web search; it did not open Settings. Once Developer options are enabled, use the normal Android Settings pages rather than that Chrome workaround.

### PowerShell connection example

Requires ADB and Node.js. The existing scripts were used with Node 24.15.0. `node:sqlite` is needed for the history export example below.

```powershell
Set-Location D:\dev\treadmill
$adb = 'C:\Program Files\ASUS\GlideX\adb.exe'

# Replace both addresses with CURRENT values from the console.
$pairAddress = '192.168.10.18:35469'   # historical example, not a fixed endpoint
$device = '192.168.10.18:41765'        # historical example, not a fixed endpoint

& $adb pair $pairAddress              # enter the new pairing code when prompted
& $adb connect $device
& $adb devices -l
& $adb -s $device shell -T id          # this firmware returned uid=0(root)
```

Pairing is normally retained. On subsequent sessions, update `$device` and run `connect`; pair again only if authorization is lost. The IP can change with DHCP, and the connection port can change after toggling wireless debugging or restarting. **Do not hard-code the observed IP, either port, pairing code, or app PID.** Factory mode/password entry was unnecessary.

If the device is offline, read the current address on the console and reconnect. `adb mdns services` may help list wireless debugging endpoints, but manual address entry was the verified discovery method here. Our first sandboxed attempt to start the ADB daemon failed; starting ADB from the user's normal PowerShell session succeeded.

### Resolve the current app PID and debugger forwarding

```powershell
$appPid = (& $adb -s $device shell -T pidof com.bodi.treadmill).Trim()
if ($appPid -notmatch '^\d+$') { throw 'Expected one running treadmill app process' }
& $adb -s $device jdwp
& $adb -s $device forward tcp:8700 "jdwp:$appPid"
node investigation/scripts/poll-live.mjs 1 connection-check.jsonl
```

The historical PID was 1218. Resolve it again after app/device restart. Port **8700 is a laptop-local forwarding port**, not the treadmill's wireless debugging port. Bindings/objects obtained through JDWP must be resolved again after restarting the app. Use one JDWP client at a time: stop a live reader before starting a setter or buffer inspector. Concurrent debugger connections can wait for the existing client to detach.

Telemetry initialization occasionally took tens of seconds, and a JDWP request timed out once. A later retry succeeded. An ADB shell that responds does not guarantee an existing debugger forwarding/client is healthy. Reconnect, resolve PID, recreate forwarding, and retry a read before sending movement commands.

## 3. Real-time data

### Read continuously using the existing script

```powershell
# Complete the connection and forwarding steps above first.
node investigation/scripts/poll-live.mjs 60 live-capture.jsonl
Get-Content investigation/telemetry/live-telemetry-latest.json
```

The duration argument accepts 1–900 seconds. The script appends JSON Lines to the selected file and overwrites `investigation/telemetry/live-telemetry-latest.json` with the latest sample. Choose a new capture filename when separate sessions should remain separate. Polling is approximately once per second; the console/controller itself exchanges data about five times per second.

Example actual sample:

```json
{
  "requestedAt": "2026-10-10T19:43:47.111Z",
  "sampledAt": "2026-10-10T19:43:47.211Z",
  "source": "app-internal",
  "unit": "METRIC",
  "state": "Running",
  "speed": 1,
  "inclineRaw": 1,
  "distance": 0.09000000357627869,
  "elapsedSeconds": 264,
  "calories": 3,
  "laps": 0,
  "statusRaw": 2,
  "pulseRaw": 81
}
```

| Data | App source | Interpretation in the observed configuration |
| --- | --- | --- |
| Speed | `BaseRunner.mSpeed` | Integer / 10 → km/h; retained setting when paused |
| Incline | `BaseRunner.mIncline` | Console displays `%`; raw value 1 was tested and moved the platform |
| Distance | `BaseRunner.mDistance` | km; binary float may need display rounding |
| Elapsed time | `BaseRunner.mDuration` | Milliseconds / 1000 → seconds |
| Calories | `BaseRunner.mCalorie` | App value in kcal; controller estimate |
| State | `BaseRunner.mState` | Resolve the enum object to its name |
| Status | `BaseRunner.mStatus` | Controller status, mapping below |
| Laps | `BaseRunner.mLaps` | App field; not an extra field in the decoded UART reply |
| Pulse | `CommandHandler.mPulse` | Controller-derived bpm; nonzero 73–82 observed |
| Units | `SerialComm.mUnit` | Read explicitly; our sessions were METRIC |

The service lookup is `RunnerService` instance → inherited `AbsRunnerService.mRunner` → `NormalRunner`/`BaseRunner`. `CommandHandler.onPulse(int)` updates `mPulse` from received serial data. `BaseRunner.setValue` does not simply assign the speed readback: incoming `ValueProtocol16` messages update speed/incline through `onDataChanged`.

The samples are reads of live fields without suspending the app, not atomic snapshots. Each field can change during collection. The reader resolves the runner once; restart it after app restart or runner replacement. These are controller/app readings, not an independent measurement of belt motion or sensor accuracy.

Pulse returned to 0 after the sensor test. Treat zero as unavailable/no reported pulse, not a physiological heart rate. Exact contact-loss behavior was not separately measured.

### State mapping

| Raw status | State |
| --- | --- |
| 0 | Normal |
| 1 | Ready / countdown |
| 2 | Running |
| 3 | Stopping |
| 4 | UnSafe |
| 5 | Error |
| 6 | Pausing |
| 7 | Paused |

The app also has `UnKnown`. A start was observed as Paused → Ready → Running. Pause was Running → Pausing → Paused. Speed remains nonzero when Paused: do not equate that field with physical belt motion.

### Read controller reply bytes

`node investigation/scripts/inspect-serial-buffers.mjs` reads the app's receive buffer and exports `investigation/serial/serial-buffer-snapshot.json` and `investigation/serial/serial-app-buffer.bin`. It also exports a validated idle poll as `investigation/serial/serial-poll.bin`, refusing to replay pending setting/key bytes. This buffer inspection may miss transient frames and is not a continuous UART capture.

For a bounded independent capture **while paused**:

```powershell
.\investigation/scripts/standalone-serial-probe.ps1 -Device $device -Adb $adb
node investigation/scripts/decode-serial.mjs serial/serial-standalone-capture.bin serial/independent-decoded.json
```

The wrapper discovers the PID, checks Paused, validates an idle poll, uploads it, suspends the app about 2.5 seconds, sends ten polls, captures bytes, restores the app, and verifies unchanged counters/settings. A cleanup trap and four-second watchdog restore the app. The test captured 13 valid frames / 208 bytes without checksum failures.

## 4. Saved workout history

Database directory: `/data/user/0/com.bodi.treadmill/databases/`.

Files: `treadmill` (SQLite), `treadmill-wal`, `treadmill-shm`. The existing local snapshot is `investigation/history/console-databases/`. The original extraction contained **552 records**, exported to `investigation/history/workout-history-raw.json` and `investigation/history/workout-history.csv`.

### Pull a snapshot

```powershell
& $adb -s $device pull /data/user/0/com.bodi.treadmill/databases ./console-databases
```

Keep the database and WAL together; pulling only `treadmill` can omit recent records. A directory pull while the app writes is not a guaranteed consistent snapshot. For repeatable sync, acquire a SQLite backup inside the console, or copy DB/WAL while writes are briefly quiesced and then restore the app. Perform the latter only while paused, using the bounded restoration pattern in `investigation/scripts/standalone-serial-probe.sh`. Do not use Android **Clear storage**: it removes app data.

The supplied `investigation/scripts/snapshot-history.sh` implements a brief app suspension, copies DB/WAL/SHM to a unique console directory, then restores the app with a trap and four-second watchdog. Use it as follows after establishing current JDWP forwarding:

```powershell
node investigation/scripts/poll-live.mjs 1 before-history-snapshot.jsonl
if ($LASTEXITCODE -ne 0) { throw 'Telemetry read failed' }
$state = Get-Content investigation/telemetry/live-telemetry-latest.json -Raw | ConvertFrom-Json
if ($state.state -ne 'Paused' -or $state.statusRaw -ne 7) {
  throw 'History snapshot requires a paused treadmill'
}
& $adb -s $device push investigation/scripts/snapshot-history.sh /data/local/tmp/snapshot-history.sh
if ($LASTEXITCODE -ne 0) { throw 'Snapshot script upload failed' }
$snapshotPath = (& $adb -s $device shell -T sh /data/local/tmp/snapshot-history.sh).Trim()
if ($LASTEXITCODE -ne 0 -or $snapshotPath -notmatch '^/data/local/tmp/treadmill-history\.[A-Za-z0-9]+$') {
  throw 'Snapshot failed'
}
# Use a new local destination to avoid combining files from different snapshots.
$snapshotLocal = Join-Path $PWD ('history-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
& $adb -s $device pull $snapshotPath $snapshotLocal
node investigation/scripts/poll-live.mjs 1 after-history-snapshot.jsonl
```

Use `$snapshotLocal/treadmill` as the database path in the export example. This snapshot helper was written for this guide and has not been executed. It assumes the vendor app is the database writer and copying finishes within the bounded suspension window; a long-running production sync should use SQLite's backup API.

### Records table

```sql
CREATE TABLE records (
  recordId INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  userId INTEGER NOT NULL,
  mode INTEGER NOT NULL,
  distance REAL NOT NULL,
  calories REAL NOT NULL,
  duration INTEGER NOT NULL,
  created INTEGER NOT NULL,
  FOREIGN KEY(userId) REFERENCES users(uid)
    ON UPDATE NO ACTION ON DELETE CASCADE
);
```

| Field | Interpretation / sync treatment |
| --- | --- |
| `recordId` | Stable record key within this database; pair with a machine/database identity |
| `userId` | Console user ID; retain it when syncing multiple users |
| `mode` | App enum: 0 Manual, 1 Time, 2 Distance, 3 Calorie, 4 Program, 5 User, 6 Hrc, -1 UnKnown |
| `distance` | Stored float; current metric sessions use km; historical unit changes are not recorded in this table |
| `calories` | Stored workout calories; preserve raw value |
| `duration` | Milliseconds, consistent with app session units and sample records |
| `created` | Unix milliseconds; app `onStopped` constructs it using `System.currentTimeMillis()` |

`created` is the record creation/finish timestamp, not necessarily workout start time. Device clock errors affect it. The table has no explicit unit column, speed/incline timeline, or pulse history. Preserve raw records, including zero-distance entries. A pause retains the active session; app code saves a record in `onStopped`. Saving through a complete stop was decoded from code, not exercised as a separate history-sync test.

### Export example (Node.js)

Save this as `export-history.mjs`, then run `node export-history.mjs`:

```javascript
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync} from 'node:fs';
const db = new DatabaseSync('investigation/history/console-databases/treadmill', {readOnly:true});
const records = db.prepare(`
  SELECT recordId,userId,mode,distance,calories,duration,created
  FROM records ORDER BY recordId
`).all();
const output = records.map(r => ({...r,
  elapsedSeconds:r.duration/1000,
  createdIso:new Date(r.created).toISOString()
}));
writeFileSync('workout-history-export.json', JSON.stringify(output,null,2));
db.close();
console.log(`Exported ${output.length} workouts`);
```

Incremental SQL: `SELECT ... FROM records WHERE recordId > ? ORDER BY recordId`. On a factory reset/database replacement, detect the new database identity or rescan instead of retaining an old high-water mark. Record IDs have gaps, so do not expect consecutive numbers.

Other tables: `programs` contains `programId`, `programName`, `speedValues`, `inclineValues`, `programTime`, `created`, `updated`; `plans` contains configured plan/progress fields; `users` contains profiles **and passwords**. Export only intended fields. Program sequence serialization and plan semantics were not decoded. For per-second workout graphs and pulse history, record live samples externally.

## 5. Three control methods

| Method | Path | Verified actions | Dependencies |
| --- | --- | --- | --- |
| Screen input | ADB `input tap` → vendor UI | Speed 2 → 1 km/h while paused |
| App method | JDWP → live `AbsRunnerService` setter → app serial sender | Speed 1 → 1.5; incline 0 → 1 while paused |
| Hardware | Root console shell → `/dev/ttyAS2` packets | Independent polling; speed 1.5 → 1; start/resume; pause |

All routes ultimately reach the same motor controller. Verify the resulting state/setting from telemetry; a successful ADB command alone does not confirm the hardware accepted a command.

### A. Clicking the app screen

The observed running-screen layout is **1024 × 600**. The stored references are `investigation/screenshots/control-before.png`, `investigation/screenshots/control-after.png`, and `investigation/screenshots/speed-selector.png`.

```powershell
# Obtain a current screenshot without piping binary PNG through PowerShell.
& $adb -s $device shell -T screencap -p /data/local/tmp/current-screen.png
& $adb -s $device pull /data/local/tmp/current-screen.png ./current-screen.png
& $adb -s $device shell -T wm size

# On the observed RunningActivity layout, open the speed shortcut grid.
& $adb -s $device shell -T input tap 796 485
Start-Sleep -Milliseconds 300
# Select "1" in the shortcut popup (top-left entry).
& $adb -s $device shell -T input tap 357 193
node investigation/scripts/poll-live.mjs 3 after-ui-speed.jsonl
```

Observed screen coordinates: incline down `(80,485)`, incline shortcuts `(228,485)`, incline up `(282,485)`, Stop `(456,485)`, Resume `(568,485)` in the paused screenshot, speed down `(742,485)`, speed shortcuts `(796,485)`, speed up `(944,485)`. Only speed shortcut selection was executed through this route. Inspect the current screen before reusing coordinates: overlays, page, resolution, and paused/running labels can change. Do not blindly click Resume/Stop at historical coordinates.

This method needs the relevant page visible. It can be useful for matching the normal user workflow, but depends on UI layout and dialogs.

### B. Calling the app interface without clicks

There was no established exported HTTP/Bluetooth/Binder API. The verified interface is direct invocation of Java methods inside the running app through JDWP.

```powershell
# Ensure CURRENT PID forwarding, with no other JDWP reader active.
node investigation/scripts/direct-speed-command.mjs 1.5
node investigation/scripts/direct-incline-command.mjs 1
```

Existing CLI guards: speed 1.0–2.0 km/h in 0.1 increments; incline integer 0 or 1; metric units; Paused/status 7 before invocation and during six readbacks. These are experiment limits, not established hardware limits. Each command writes `direct-<setting>-command-result.json` and appends to `direct-<setting>-command-audit.jsonl`.

| Java method on `AbsRunnerService` | Argument | Evidence |
| --- | --- | --- |
| `setSpeed(I)V` | Integer tenths of km/h: 15 = 1.5 | Invoked and confirmed |
| `setIncline(I)V` | Integer raw incline: 1 | Invoked; user confirmed physical movement |
| `start()V`, `resume()V`, `pause()V`, `stop()V` | None | Found in code; not invoked through the JDWP test CLI |

`setSpeed` delegates to `BaseRunner.setValue(newSpeed, existingIncline)`; `setIncline` retains the existing speed. App setters clamp to configured bounds and post a setting frame. They do not issue start/resume. `AbsRunnerService.pause()` checks that state is Running before delegating. See `investigation/app/control-disassembly.txt` for exact service state guards and start/resume lifecycle logic.

#### Invocation mechanics needed for extending the prototype

`investigation/scripts/direct-setting-command.mjs` contains the working implementation:

1. Resolve service instance, inherited runner, metric enum, and current fields; require Paused.
2. Resolve the setter's runtime class/method IDs. Do not hard-code debugger IDs.
3. Find the thread named `main` and `android.os.Handler.dispatchMessage(Landroid/os/Message;)V`.
4. Set a one-shot entry breakpoint through JDWP EventRequest.Set (15:1), event kind 2, suspend policy 1 (event thread only), modifiers **ThreadOnly, LocationOnly, Count(1)** in that order. Put the count filter last.
5. Wait for the matching Composite Event (64:100); recheck Paused at the invocation point.
6. Use ObjectReference.InvokeMethod (9:6) on the service, with the main thread, setter class/method IDs, one tagged integer argument, and invocation option 1 (`INVOKE_SINGLE_THREADED`).
7. Read the return/exception; resume the thread with ThreadReference.Resume (11:3).
8. Confirm six readbacks; detach with VirtualMachine.Dispose (1:6) in `finally`, clearing debugger requests/suspensions.

The serial worker remains running. JDWP method invocation needs an event-suspended thread; merely sending InvokeMethod from an arbitrary active thread is insufficient. If the main thread is idle during the 30-second event wait, run this in another PowerShell window:

```powershell
& $adb -s $device shell -T dumpsys activity com.bodi.treadmill/.ui.RunningActivity
```

This read-only activity dump can queue a main-thread message. The script intentionally avoids launching subprocesses: Node child-process creation was denied in our execution environment. A production console bridge should replace this debugger prototype with a supported app integration or coordinated serial ownership.

### C. Sending commands directly to the hardware UART

The verified endpoint is `/dev/ttyAS2`, configured by the running vendor app at 19200 baud, 8 data bits, no parity, 1 stop bit, raw mode, no flow control. App polling is about every 200 ms, receiving about every 195 ms. Historical app FD was 101; use the device path, not that FD number.

#### Frame format

Every tested frame is 16 bytes:

| Offset | Common meaning |
| --- | --- |
| 0 | `FD` start marker |
| 1 | `01` normal poll/setting/reply type |
| 2–13 | Direction-specific payload |
| 14 | Sum of bytes 1–13 modulo 256 |
| 15 | `FE` end marker |

App's active protocol was `ValueProtocol16`. Another variant exists in the APK but was not used in our captures.

#### Console → controller

| Offset | Meaning for tested commands |
| --- | --- |
| 2 | `01` for speed/incline setting; `00` for idle/key frame |
| 3 | Desired speed in tenths of km/h when setting |
| 4 | Desired incline when setting |
| 5–11 | Zero in the tested packets |
| 12 | Persistent login flag; `01` in this logged-in session |
| 13 | Key command: `00` none, `47` start/resume, `5C` pause |

Send both speed and incline in a setting frame; retain the desired/current value of the other setting. Zero setting bytes in a key/idle frame do not mean set speed/incline to zero. After writing a command, the app clears transient setting/key bytes, retaining the login flag. Send each action once rather than continually replaying it.

| Action | Complete hex packet | Evidence |
| --- | --- | --- |
| Idle poll | `FD0100000000000000000000010002FE` | Independent capture verified |
| Set speed 1.0, incline 1 | `FD01010A010000000000000001000EFE` | Independent readback verified |
| Start/resume | `FD0100000000000000000000014749FE` | Physical run and Running telemetry verified |
| Pause | `FD0100000000000000000000015C5EFE` | Pausing → Paused verified |
| Stop key | `48` at byte 13, checksum `4A` with login 1 | Decoded from `BaseRunner.stop`; not executed in our tests |

Login byte behavior when logged out and controller startup/configuration packets were not established. The exact packets above apply to the observed logged-in metric session.

#### Controller → console

| Offset | Meaning | Conversion |
| --- | --- | --- |
| 2 high nibble | State | Mapping in section 3 |
| 2 low nibble | Additional status | Meaning unresolved; retain raw bits |
| 3 | Speed setting | /10 → km/h |
| 4 | Incline | Raw integer |
| 5–6 | Elapsed time | Unsigned 16-bit big endian seconds |
| 7–8 | Distance | Unsigned 16-bit big endian /100 → km |
| 9–10 | Calories | Unsigned 16-bit big endian /10 → kcal |
| 11 | Pulse | bpm |
| 12 | Error code | 0 observed; individual code meanings unresolved |
| 13 | Input code | 0 observed; event meanings unresolved |

Example: `FD01700F0100BF000700140000005BFE` → Paused, speed 1.5 km/h, incline 1, 191 seconds, 0.07 km, 2 kcal, pulse/error/input 0. Validate frame type, markers, and checksum before accepting a sample. `investigation/scripts/decode-serial.mjs` scans/resynchronizes captured bytes and performs these checks. The 16-bit counters have finite ranges; overflow/reset behavior was not tested.

#### Create and send an exact packet (PowerShell 7)

```powershell
# Example changes the speed setting to 1 km/h and retains incline 1.
[IO.File]::WriteAllBytes(
  (Join-Path $PWD 'setting.bin'),
  [Convert]::FromHexString('FD01010A010000000000000001000EFE')
)
& $adb -s $device push setting.bin /data/local/tmp/treadmill-setting.bin
& $adb -s $device shell -T 'cat /data/local/tmp/treadmill-setting.bin > /dev/ttyAS2'
node investigation/scripts/poll-live.mjs 3 setting-readback.jsonl
```

Use binary files, not `echo` of hex text. In our independent speed experiment, the app was briefly suspended and a separate UART reader captured baseline and new-setting replies; see `investigation/scripts/standalone-serial-speed.sh`. During verified start/pause tests, the vendor app stayed running and kept its normal polling/reading while root shell commands wrote single key packets. Coexisting writers worked in those tests but are not a validated persistent multi-client design.

#### General frame construction example (Node.js)

```javascript
import {writeFileSync} from 'node:fs';
function frame({speedTenths, incline, key=0, login=1}={}) {
  const b=Buffer.alloc(16);
  b[0]=0xfd; b[1]=1; b[12]=login; b[13]=key; b[15]=0xfe;
  if (speedTenths!==undefined || incline!==undefined) {
    if (!Number.isInteger(speedTenths) || !Number.isInteger(incline) ||
        speedTenths<0 || speedTenths>255 || incline<0 || incline>255 || key!==0)
      throw Error('Provide both byte-valued settings, with no key');
    b[2]=1; b[3]=speedTenths; b[4]=incline;
  }
  b[14]=b.subarray(1,14).reduce((sum,x)=>(sum+x)&255,0);
  return b;
}
writeFileSync('setting.bin',frame({speedTenths:10,incline:1}));
writeFileSync('start.bin',frame({key:0x47}));
writeFileSync('pause.bin',frame({key:0x5c}));
```

Byte range validation is not a physical speed/incline limit. Raw commands bypass app clamping. Read the machine configuration before exposing wider ranges; only low-speed settings and incline 0/1 were exercised.

#### Bounded start/pause example

Prepare a paused machine, confirm metric units/speed/incline with a fresh telemetry read, and upload the existing start/pause binaries. A movement command should have an on-console pause timer armed before sending Start, so laptop disconnection does not remove the scheduled pause.

```powershell
& $adb -s $device push investigation/serial/serial-start-command.bin /data/local/tmp/treadmill-start.bin
& $adb -s $device push investigation/serial/serial-pause-command.bin /data/local/tmp/treadmill-pause.bin
& $adb -s $device push investigation/scripts/start-cycle.sh /data/local/tmp/start-cycle.sh

# Arms a 45-second fallback pause, then sends Start. It does not set speed/incline.
& $adb -s $device shell -T sh /data/local/tmp/start-cycle.sh
# Watch Ready -> Running; count an intended run interval from Running, not Ready.
node investigation/scripts/poll-live.mjs 3 running-check.jsonl

# Sends Pause immediately, then verify Pausing -> Paused.
& $adb -s $device shell -T 'cat /data/local/tmp/treadmill-pause.bin > /dev/ttyAS2'
node investigation/scripts/poll-live.mjs 5 pause-check.jsonl
```

`investigation/scripts/pause-cycle.sh` schedules Pause 30 seconds after that script is launched, not after hardware enters Running. `investigation/scripts/pulse-test-cycle.sh` arms a 90-second fallback and sends Start. These are diagnostic scripts, not a state-aware scheduler. The requested 30-second run added 33 seconds to the counter, including command timing/deceleration. Do not treat a timer or ADB exit code as confirmation of Paused; verify controller status 7.

For a precise future cycle, continuously monitor state in one bridge, record the first Running timestamp, schedule Pause relative to it, and verify the resulting Paused state. Keep an independent maximum-duration timer on the console.

### UART ownership for a future bridge

Two readers on the same UART compete for bytes. Do not run a second permanent reader beside the vendor app. The short SIGSTOP/restore probe was a diagnostic handoff, not an architecture for continuous operation. Choose coordinated ownership: a single bridge owns polling/reading and exposes data/control to clients, or integrate with the vendor app's existing serial owner. Preserve its login/configuration/heartbeat behavior; a standalone cold-start controller initialization sequence has not been established.

The external app therefore needs a bridge on the Android console (or separately engineered physical UART access). The experiments establish packet and app-method semantics for the running configuration; they do not establish a ready-to-deploy authenticated network service.

## 6. Evidence and reusable files

| File | Purpose |
| --- | --- |
| `investigation/scripts/jdwp-read.mjs` | Node JDWP client; metadata/value-read allowlist and clean detach |
| `investigation/scripts/poll-live.mjs` | Live session + pulse JSONL capture |
| `investigation/scripts/direct-setting-command.mjs` | Guarded JDWP setter invocation implementation |
| `investigation/scripts/direct-speed-command.mjs`, `investigation/scripts/direct-incline-command.mjs` | Setter CLI wrappers |
| `investigation/scripts/inspect-serial-buffers.mjs` | Read app serial buffers and validate idle poll |
| `investigation/scripts/standalone-serial-probe.ps1`, `.sh` | Bounded independent paused UART capture |
| `investigation/scripts/standalone-serial-speed.sh` | Exact guarded raw speed-setting experiment |
| `investigation/scripts/decode-serial.mjs` | Validated 16-byte reply decoder |
| `investigation/scripts/start-cycle.sh`, `investigation/scripts/pause-cycle.sh`, `investigation/scripts/pulse-test-cycle.sh` | Timed movement experiment helpers |
| `investigation/history/console-databases/`, `investigation/history/workout-history-raw.json`, `investigation/history/workout-history.csv` | Original history snapshot/exports |
| `investigation/scripts/snapshot-history.sh` | New bounded DB/WAL copy helper; not executed |
| `investigation/telemetry/moving-telemetry.jsonl`, `investigation/telemetry/telemetry-validation.json` | Initial changing telemetry evidence |
| `direct-*-command-result.json`, `direct-*-command-audit.jsonl` | Setter readbacks and audits |
| `investigation/serial/serial-standalone-capture.bin`, `investigation/serial/serial-decoded.json` | Independent idle UART replies |
| `investigation/serial/serial-speed-capture.bin`, `investigation/serial/serial-speed-decoded.json` | Raw setting accepted by controller |
| `investigation/telemetry/start-cycle-running.jsonl`, `investigation/telemetry/start-pause-cycle.jsonl` | Raw start/pause state transitions |
| `investigation/telemetry/pulse-sensor-test.jsonl` | 90 live samples; pulse sensor response and return to zero |
| `investigation/app/control-disassembly.txt` | Decoded app methods/protocol implementation |
| `investigation/app/treadmill-console.apk`, `investigation/app/classes.dex`, `investigation/app/classes2.dex` | Preserved firmware/app evidence |
| `docs/hardware-protocol.md` | Focused packet reference and experiment notes |
| `docs/investigation.md` | Chronological investigation log; early entries describe earlier knowledge |

## 7. Session reset and countdown (additional code discovery)

These paths were decoded after the initial integration guide. Stop and manual-mode initialization were subsequently tested; countdown has not been executed on the machine.

### End the session and clear counters

`AbsRunnerService.stop()V` accepts Running or Paused, then calls the runner's `stop()`. `BaseRunner.stop()` sends key `0x48`. With the observed login flag 1, the corresponding raw packet is `FD010000000000000000000001484AFE`.

On the controller's transition to status 0 (Normal), `BaseRunner.onStatusChanged` calls `onStopped(getRunParam())` for a session that was Stopping or Paused, then `reset()`. The app's `onStopped` saves the workout record; `reset()` removes session callbacks, sets Normal, and calls `clean()`, which zeros duration, distance, calories, speed, and incline in app state. This is the decoded normal end-session path, not deletion of historical records. Confirm actual controller counters and displayed values before treating it as verified hardware reset behavior.

Calling `BaseRunner.reset()` or editing fields alone only clears app state and does not send the controller Stop key; later controller data could overwrite it. Prefer the normal Stop/end-session path. Do not infer physical incline movement from app `clean()` setting its incline field to zero.

**Stop/reset test result (2026-10-10, 19:59 UTC):** Starting from Paused, 267 seconds, 0.09 km, 3 kcal, speed 1 and incline 1, sent `FD010000000000000000000001484AFE`. App returned to Home, controller reported Normal/status 0, and record 553 was saved for user 3, mode 0, distance 0.09, calories 3, duration 267000 ms. Total history count became 553. Speed/incline/distance readbacks became zero, but elapsed time and calories remained 267 and 3. Raw reply `FD01000000010B0000001E0000002BFE` confirmed these retained controller counters, rather than merely stale app fields.

Next sent the decoded normal-mode initialization frame `FD0304000000000000000000010008FE` (type 03, mode 04, login 1, key 0). Four readbacks still showed Normal, zero distance/speed/incline, and retained time/calories. Therefore **Stop ends/saves the workout but is not a verified immediate reset of all controller counters**. Reset-on-next-start remains untested; no new start was sent during this experiment. Do not advertise a full reset command based on these results.

Artifacts: `investigation/serial/serial-stop-command.bin`, `investigation/serial/serial-normal-mode-command.bin`, `investigation/telemetry/before-stop-reset.jsonl`, `investigation/telemetry/after-stop-reset.jsonl`, `investigation/telemetry/after-normal-mode-reset.jsonl`, `investigation/screenshots/stop-reset-screen.png`, `investigation/history/stop-reset-databases/`. For an external app, a fresh local session can use a captured baseline and subtract its elapsed/distance/calorie counters while accounting for hardware resets; that does not change the treadmill's counters.

At the user's request, repeated Stop followed one second later by normal-mode initialization at 20:01 UTC. Four samples in `investigation/telemetry/repeated-stop-reset.jsonl` still reported Normal, distance 0, elapsed 267 seconds, calories 3. Repeating the sequence did not clear retained time/calories. The user's normal workaround is starting and immediately stopping; that cycle has not been tested for reset through this interface.

**Full counter reset subsequently verified at 20:03 UTC:** At the user's explicit request, `investigation/scripts/start-stop-reset.sh` sent Start, waited 0.3 seconds, and sent Stop (plus cleanup Stop), with an independent additional Stop scheduled after five seconds. The early Stop did not prevent Ready/countdown progressing to Running. Telemetry briefly showed Running at 1 km/h, incline 0, then Stopping and Normal when the fallback Stop was delivered. All counters became zero: elapsed 0, distance 0, calories 0, speed 0, incline 0. Raw reply `FD0100000000000000000000000001FE` independently confirmed zero counters and Normal/status 0. Capture: `investigation/telemetry/after-start-stop-reset.jsonl`. This validates **start then stop after reaching Running**, not a guaranteed motion-free reset; the treadmill ran briefly. For future implementation, wait for Running then promptly Stop, keeping an independent fallback Stop. Stop during Ready/countdown was ineffective in this experiment.

### Countdown workouts

App interface: `AbsRunnerService.setCountDownMode(Mode, float)`. For a time goal, use the enum object `Mode.Time` and a minute value, for example `20.0f`. This selects/constructs a `CountdownRunner`; `setCountdownValue` converts minutes × 60 × 1000 to its millisecond target and stores it in `RunParam.countdown`. `CountdownRunner.doRunning` compares elapsed time with the target and sends Stop when the target is reached. Time, Distance, and Calorie goal modes exist. Switching runner mode can close/replace the current runner, so configure goals between sessions and reconnect the live reader afterward.

For a countdown display in an external app, keep recording elapsed time and calculate `remainingSeconds = max(0, goalSeconds - elapsedSeconds)`; paused elapsed time remains stable. Automatic pause/stop at zero is a separate control action. The app's timed goal code uses Stop, which ends/saves the workout, rather than Pause.

There is also a decoded UART time-goal setter: frame type byte 1 = `03`, byte 2 = `01`, target seconds as big endian bytes 5–6, login retained at 12, key zero. `SerialComm$ValueTask.setCountdownTime` takes integer minutes and multiplies by 60 before encoding. This path is not hardware-tested; do not assume the existing type-01 reply decoder describes all mode-03 behavior.

Evidence: `investigation/app/reset-countdown-disassembly.txt`, including `Mode`, `CountdownRunner`, and the existing service/protocol methods.

### Isolated reset experiment: no prior Stop or manual-mode initialization

On 2026-10-10, ran a fresh session at 1 km/h, incline 0, then paused. Intended duration was one minute; debugger reconnection/timer delays resulted in **87 seconds**, 0.02 km, 1 kcal. Independent baseline capture `investigation/serial/isolated-reset-baseline.bin` contained 13 valid identical Paused replies with those counters. No Stop or manual-mode initialization was sent during this fresh session before the reset experiment.

Then `investigation/scripts/isolated-start-stop-reset.sh` sent Resume, waited four seconds for countdown to finish, and sent Stop, with cleanup Stop and a seven-second fallback Stop. Independent after-capture `investigation/serial/isolated-reset-after.bin` contained 14 valid Normal replies with **time 0, distance 0, calories 0, speed 0, incline 0**. Decoded captures: `investigation/telemetry/isolated-reset-baseline.json` and `investigation/telemetry/isolated-reset-after.json`.

This establishes that **resuming the paused workout and stopping after countdown can clear all counters without the earlier Stop/manual-mode initialization sequence** on this firmware. It does not prove a single Stop while paused clears them, nor a motion-free reset. Fixed countdown waits are diagnostic; a production bridge should detect Running then Stop promptly and verify Normal/zero counters.

History snapshot `investigation/history/isolated-reset-history/` confirmed new record 555: mode 0, user 3, duration 89000 ms, distance 0.02 km, calories 1 (the resume/stop added about two seconds). A stalled debugger reader was terminated and local forwarding removed afterward; recreate forwarding before the next JDWP read.

## 8. Established scope and remaining unknowns

Future work can reuse the connection procedure, database path/schema, telemetry lookup, guarded setters, UART format, and verified low-speed start/pause packets directly on this firmware. Remaining unknowns are error/input/status-bit meanings; historical unit changes; full configured speed/incline limits; controller cold-start initialization; logged-out behavior; alternate protocol variants; hardware validation of Stop/reset and countdown; and a persistent bridge's ownership/recovery design. These were not needed for the verified experiments, and are not presented as solved.

Last verified state after the pulse test: **Paused**, retained speed **1 km/h**, incline **1**, workout time **267 seconds**, distance **0.09 km**, calories **3**, pulse eventually **0**. This is historical context, not a substitute for a fresh read before a later command.
