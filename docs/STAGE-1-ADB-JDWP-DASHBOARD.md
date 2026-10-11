# Stage 1 implementation brief: external dashboard using ADB + JDWP

Audience: a coding agent such as luna-medium. Implement this document in order. It specifies the application, not a new treadmill investigation. Stage 2 replaces the transport; preserve the contracts here.

## 1. Deliverable and boundaries

Build a working local web dashboard in `D:\dev\treadmill/dashboard/`, served by a Node.js server on the Windows laptop. A phone on the same LAN can open it. Read real live telemetry and import real saved workouts. Provide explicit speed/incline, start/resume, pause, finish, and reset commands with readback confirmation.

Use the existing treadmill app and verified interfaces. Stage 1 uses wireless ADB for connection, history, and UART key writes; JDWP for telemetry and app setting methods. Do not require a console APK, cloud account, UI clicking, Frida, or controller takeover. Starting the server/reconnecting/importing history must not move the treadmill.

Building software does not authorize unattended physical tests. Leave movement checks for a user-attended session. Do not run movement commands from startup, package scripts, fixtures, or installation steps.

## 2. Read these existing files first

Paths are relative to repository root, one directory above `docs/`:

1. `TREADMILL-INTEGRATION-GUIDE.md` — full evidence; later reset experiments supersede earlier hypotheses.
2. `jdwp-read.mjs` — working JDWP binary client, readers, runtime ID sizes.
3. `poll-live.mjs` — exact live field/enum/service lookup, including pulse.
4. `direct-setting-command.mjs` — working safe invocation breakpoint and setters.
5. `decode-serial.mjs` — validated incoming packet decoder.
6. `snapshot-history.sh` — bounded database snapshot helper, written but not hardware-tested.
7. `isolated-start-stop-reset.sh` and corresponding captures — reset evidence, not a production scheduler.

Do not modify/delete original APKs, captures, database snapshots, or investigation evidence. Refactor/copy reusable logic into the new app; retain attribution in comments. Older chronological notes say capabilities were unknown at that time; they are not current limitations.

## 3. Fixed implementation choices

- Node.js 24, JavaScript ES modules; built-in `http`, `child_process`, `crypto`, `fs`, `events`, `node:sqlite`.
- One runtime npm dependency: `ws` for browser WebSockets. Lock dependencies in `package-lock.json`.
- Plain HTML/CSS/JavaScript frontend; no React, build framework, or external CDN required.
- SQLite file `dashboard/data/dashboard.sqlite`; migrations in source.
- Default server port 8080. Bind `127.0.0.1` by default; explicit configuration permits `0.0.0.0` for phone access.
- ADB path configurable, default `C:\Program Files\ASUS\GlideX\adb.exe`.
- Device address configurable at runtime; never hard-code the old IP/port/PID.
- Generate a dashboard access token on first run. Store locally with config, never return it from status/config GET or put it in logs. Browser login exchanges token for an HttpOnly, SameSite=Strict cookie. Serve frontend/API on same origin; check Origin on mutations and WebSocket handshake. LAN bind should require authentication.

Suggested tree:

```text
dashboard/
  package.json
  package-lock.json
  README.md
  config.example.json
  server/
    index.mjs                 # startup, HTTP, websocket lifecycle
    config.mjs
    auth.mjs
    api.mjs
    store.mjs                # sqlite migrations, upserts, capture queries
    coordinator.mjs          # queue, confirmation, reset state machine
    session-recorder.mjs
    transport.mjs            # documented adapter contract
    transports/
      adb-jdwp.mjs
      simulator.mjs          # optional explicit demo mode; never silent fallback
    jdwp/
      client.mjs
      telemetry.mjs
      invoke-setting.mjs
    device/
      stop-watchdog.sh
      snapshot-history.sh
  public/
    index.html
    styles.css
    app.js
  data/                      # ignored: config secrets, sqlite, snapshots
```

Do not attempt to use Node's nonexistent built-in SQLite before checking Node version. In restricted execution environments Node subprocess creation previously failed with EPERM: report that clearly and allow running the server in ordinary user PowerShell; do not silently fall back to fake telemetry.

## 4. Shared contracts: implement exactly, keep for Stage 2

### Transport adapter

Extend EventEmitter, with async methods:

```javascript
connect(config)                // no motion
disconnect()                   // detach and cleanup, no automatic movement
getCapabilities()
readTelemetry()                // fresh normalized sample
sendAction(action)             // validate + send once; receipt is not confirmation
fetchHistory({afterRecordId, limit})
armStopWatchdog({operationId, delayMs})
cancelStopWatchdog(operationId) // only after confirmed stop / operation completion
```

Events: `telemetry` (sample), `connection` (connection object), `error` (sanitized error). `sendAction` accepts only the allowlist below and returns `{sentAt, transportReceipt}`. All public actions go through coordinator, not directly from an HTTP route to transport. Use one in-flight motion/setting operation per machine. Stop has priority over queued setting/start actions; cancel queued starts when Stop arrives.

Connection object:

```json
{"state":"connected","transport":"adb-jdwp","machineId":"g700x-<serial>","address":"192.168.x.y:port","lastSampleAt":"ISO UTC","reason":null}
```

States: disconnected, connecting, connected, stale, error. Use sample age, not socket state alone. A sample older than 3 seconds is stale; reject new starts/settings/reset on stale data. Stop/Pause may be sent as best-effort actions when ADB is reachable even if telemetry is stale; report unconfirmed until readback. No automatic Start replay after reconnect.

Normalized telemetry (all keys present, unavailable values null):

```json
{
  "schemaVersion":1,"machineId":"g700x-example","connectionEpoch":"uuid",
  "sequence":123,"sampledAt":"ISO UTC","receivedAt":"ISO UTC",
  "source":"app-jdwp","unit":"METRIC","state":"Running","statusRaw":2,
  "speedKph":1.0,"inclinePercent":0,"elapsedSeconds":60,
  "distanceKm":0.02,"caloriesKcal":1,"pulseBpm":null,"laps":0,
  "errorCode":null,"inputCode":null,"statusLowNibble":null,
  "quality":{"atomic":false,"stale":false}
}
```

Stage 1 error/input/status-low fields can be null; do not invent zero unless read. Pulse raw 0 becomes null. Preserve raw counters in storage; formatting/float rounding belongs in UI. Speed when Paused is a setting, not measured belt motion. Incline display uses percent according to vendor UI; independent geometric calibration was not performed.

Action shapes:

```json
{"type":"setSpeed","speedKph":1.5}
{"type":"setIncline","inclinePercent":1}
{"type":"start"}
{"type":"resume"}
{"type":"pause"}
{"type":"stop"}
{"type":"reset","allowBriefMotion":true}
```

Initial supported setting ranges were experimentally validated only at 1.0–2.0 km/h in steps of 0.1 and incline 0 or 1, while Paused. The user later requested ranges 0.0–20.0 km/h and incline 0–15, including changes while Running; the implementation now accepts these values while Running or Paused, except speed 0 is Paused-only. Expanded ranges and live setter behavior have not been independently validated on the console; the transport still requires fresh metric telemetry and confirms unchanged other-setting readback.

Commands receive UUID `commandId`. Browser POST includes unique `requestId`; persist mapping so retrying the same ID returns the original operation and never repeats motion. Same requestId with different body → conflict. Terminal states: confirmed, rejected, failed, unknown. Intermediate: queued, sent, verifying. A delivery timeout after possible transmission is **unknown**, not safe to retry automatically.

### Public dashboard API

```text
POST /api/login                     {token}
POST /api/logout
GET  /api/status                    connection + capabilities + latest telemetry
GET  /api/config                    nonsecret connection settings
PUT  /api/config                    {adbPath,deviceAddress,transport,...}
POST /api/connect                   use saved config, no motion
POST /api/disconnect
POST /api/pair                      {pairAddress,code}; code never persisted/logged
POST /api/commands                  {requestId,action} -> 202 {commandId}
GET  /api/commands/:id
POST /api/history/sync
GET  /api/workouts?limit=50&cursor=...
GET  /api/workouts/:id
GET  /api/workouts/:id/samples
GET  /api/export/workouts.csv
GET  /api/live-sessions/:id/samples
WS   /ws                            authenticated same-origin browser connection
```

Validate JSON size (max 16 KiB), types, decimal precision, known keys/actions, endpoint strings, and request IDs. Use JSON error `{code,message,commandId?}` and consistent 400/401/409/503 responses. Do not expose arbitrary shell, raw packets, JDWP methods, file paths, or user SQL through HTTP.

WS messages: `{type:'status'|'telemetry'|'command'|'history',data:...}`. On reconnect send a complete snapshot; no commands replayed by frontend. Bound slow-client buffering and close slow clients rather than blocking telemetry/control.

## 5. Connection and JDWP implementation

Known machine: Android 11 / Allwinner A133, firmware v1.5.5-yjnp; app `com.bodi.treadmill`, versionCode 57. Root ADB shell confirmed. Historical address `192.168.10.18:41765` and PID 1218 are examples only.

Pairing page has its own short-lived address/port/code. Main Wireless debugging page has the connection address/port. Pair once, connect using main-page endpoint; pairing normally survives reconnect.

Use `execFile(adbPath, argumentArray)` with `shell:false`, bounded timeouts/output, and no string-built Windows shell. Input validation prevents shell metacharacters entering device commands. Pair command must feed code over stdin or another supported ADB mechanism without logging it; handle prompt/output and timeout. Do not put pairing secrets in app logs.

Connection sequence:

1. Validate endpoint hostname/IP + TCP port, no userinfo/scheme/path/shell text.
2. `adb connect <address>`, then inspect `adb devices -l` for exact serial state.
3. `adb -s <device> shell -T id`, `pidof com.bodi.treadmill`, `jdwp`.
4. Require one numeric PID present in debugger process list; never reuse old PID after restart.
5. Allocate a laptop-local port with `adb -s <device> forward tcp:0 jdwp:<PID>`; parse returned port. Own/remove only this adapter's forwarding.
6. Connect JDWP and resolve classes/fields/instances/enum values as in existing reader.
7. Read a sample before declaring connected.

Use one long-lived JDWP client owned by the adapter. **Do not spawn the CLI reader and CLI setter simultaneously.** Extract their logic into functions using the same client. Serialize reads and invocation metadata operations. Resolve `mRunner` again after session mode replacement, not just process restart; all debugger IDs are session-scoped.

Fix prototype client weaknesses: TCP connection/handshake deadline; bounds on packet lengths; disconnect/end/close reject pending promises and clear timers; command deadlines; idempotent bounded detach; clean shutdown. Metadata/instance scanning was sometimes slow. Use 30 seconds for initial attach/metadata, 10 seconds for individual requests, never hang forever. If no fresh sample, controls remain unavailable. Backoff reconnect at 1,2,4,8 seconds capped at 15 seconds; never replay actions.

Telemetry lookup:

- `RunnerService` active instance; inherited `AbsRunnerService.mRunner` → `BaseRunner`.
- Fields `mSpeed` integer /10, `mIncline`, `mDuration` /1000, `mDistance`, `mCalorie`, `mLaps`, `mState`, `mStatus`.
- `State` static enum fields resolve names.
- `SerialComm.mUnit`, compare `Unit.METRIC` before metric operations.
- `CommandHandler.mPulse`, from serial callback; zero unavailable.
- Poll 1 Hz. App UART poll is 200 ms; snapshots are not atomic.
- Status: 0 Normal, 1 Ready, 2 Running, 3 Stopping, 4 UnSafe, 5 Error, 6 Pausing, 7 Paused.

## 6. Control implementation

### Speed/incline through app methods

Reuse the JDWP invocation pattern from `direct-setting-command.mjs`; dashboard-only state and range guards are documented below. Main-thread one-shot Handler.dispatchMessage entry breakpoint, EventRequest.Set 15:1, event kind 2, event-thread suspension policy 1. Modifier order **ThreadOnly, LocationOnly, Count(1)**. Await Composite Event 64:100; recheck that the treadmill remains in the same Running or Paused metric state observed before invocation. Invoke `AbsRunnerService.setSpeed(I)V` (tenths) or `setIncline(I)V` with ObjectReference.InvokeMethod 9:6, option 1 (single-threaded). Check exception, ThreadReference.Resume 11:3 in finally, and cleanup events. Do not VM-suspend, field-write, or leave main thread suspended. At 30 seconds without event fail/detach; optional activity dumpsys can queue a main-thread message. Never use screen taps as an invocation fallback.

Confirmation: fresh controller-derived app readbacks at desired value and unchanged other setting, same Running or Paused state, two consecutive samples. Paused counters must remain stable; Running counters may advance but must not regress. Timeout 10 seconds after invocation → unknown with last observed state.

When extracting the prototype, change its cleanup ownership: the CLI's `finally` calls JDWP Dispose/close because it owns the connection. The adapter owns a long-lived connection, so successful setters must instead resume their thread and clear any outstanding request using EventRequest.Clear (15:2), then return control to polling. Dispose only on adapter disconnect or an unrecoverable debugger cleanup error. If event setup/invocation fails, clean the one-shot request and suspension explicitly; if cleanup cannot be confirmed, detach before reconnecting. Never carry an event timeout or suspended thread into the next command.

### Start/resume/pause/stop through verified ADB UART writes

Use static binary files uploaded to a fixed private working directory such as `/data/local/tmp/treadmill-dashboard/`; fixed helper scripts, no user-generated arbitrary shell. Existing packet format below is the observed logged-in metric configuration. Validate current outgoing login flag is 1 using buffer inspection at connection setup; if another value is observed, reject unsupported configuration rather than guessing.

```text
Start/resume: FD0100000000000000000000014749FE
Pause:        FD0100000000000000000000015C5EFE
Stop:         FD010000000000000000000001484AFE
Idle:         FD0100000000000000000000010002FE
```

Frame: 16 bytes, FD/type/payload/checksum/FE. Checksum sum bytes 1–13 modulo 256. Key byte 13: 0x47 start, 0x5c pause, 0x48 stop; login byte 12 = 1. Start does not mean set desired speed to zero just because setting bytes are zero. Vendor app remains sole reader/poller. ADB script only writes one complete frame with `cat fixed-file > /dev/ttyAS2`; never opens a second reader during normal operation. Coexisting single command writes were experimentally successful; serialize all bridge writes.

Rules and expected transitions:

| Action | Allowed source | Confirmation |
| --- | --- | --- |
| start | Normal, fresh sample | Ready → Running |
| resume | Paused | Ready → Running |
| pause | Running | Pausing → Paused |
| stop | Running or Paused | Stopping/Normal → Normal (may retain time/calories) |
| reset | Normal or Paused; explicit brief-motion acknowledgment | See below, Normal and all counters zero |

Start from Normal empirically defaults to 1 km/h, incline 0; display this expectation, do not claim saved settings will be restored. Start/resume require a bounded on-console watchdog armed first (default 120 seconds maximum running per remote start for this first version). Watchdog must be independent of browser/server availability, write Pause or Stop according to recorded policy, and publish deadline in command/status. Do not arm repeated starts. For exact timed operation, use controller Running telemetry, not Ready/countdown. Pause/Stop not reaching target by timeout → unknown; offer best-effort Stop, not hidden repeated Start.

### Reset: evidence and exact state machine

Verified facts:

- Stop while Paused saved record 553 and cleared distance but retained 267 seconds/3 kcal.
- Repeating Stop/manual-mode initialization did not clear retained values.
- Stop sent during Ready/countdown did not prevent movement.
- Fresh paused session at 87 seconds/0.02 km/1 kcal: **Resume, wait through countdown, Stop** cleared all counters without any prior Stop/manual-mode initialization. Saved record 555 (89 seconds including brief resume).

Implement Reset as a clearly labeled operation that **briefly moves the belt**. No hidden reset on Finish or page navigation. Body must contain `allowBriefMotion:true`; UI requires deliberate acknowledgment for that operation.

State machine:

1. Acquire command lock; read fresh telemetry. If Normal and all three counters already zero, confirm no-op.
2. Require METRIC; reject Error/UnSafe/Ready/Stopping/Pausing/Running. If Running, user must Pause or Finish explicitly first.
3. Arm independent on-console Stop watchdog for 8 seconds; record operation ID/deadline. If arming fails, reject before Start.
4. Send Start/Resume once. Monitor every 200–500 ms while operation active using the same adapter client; no new JDWP sessions.
5. On first Running sample, send Stop immediately. Do not use a four-second wait as the main algorithm.
6. If Running is not seen within 6 seconds, report timeout/unknown; leave Stop watchdog active. Never send Start again.
7. Verify Normal/status0 AND elapsedSeconds=0, distanceKm≈0, caloriesKcal≈0 in two fresh samples. Preserve last nonzero session data for history correlation.
8. Cancel watchdog only after confirmed Normal/zero state. If Normal but retained counters, report partial reset; do not automatically loop.
9. Sync saved records after confirmation. Add reset-induced saved records normally; don't delete "short" workouts.

Create device watchdog script with fixed allowlisted files and validated numeric delay/op UUID. Keep PID and deadline per operation. Make cancellation kill the actual sleeping worker before it can write; no orphan sleep that still fires after cancel. Test logic offline when verification is requested, with device actions injected; no physical automatic test. A laptop-side timeout alone is insufficient.

## 7. History, live sessions, and persistence

Console DB `/data/user/0/com.bodi.treadmill/databases/treadmill`, plus WAL/SHM. `records` columns: recordId, userId, mode, distance, calories, duration, created. Duration ms; created Unix ms **finish/creation time**, device-clock-dependent. Mode: 0 Manual,1 Time,2 Distance,3 Calorie,4 Program,5 User,6 Hrc,-1 UnKnown. Historical units not recorded; retain raw distance and set unit provenance to current-console-assumed, not proven for all history.

Import existing `workout-history-raw.json` only through explicit demo/import option. Normal Sync retrieves a new snapshot. While Normal/Paused, use bounded DB/WAL snapshot helper; original helper only documented Paused, so carefully extend its UI guard to Normal as a new implementation condition. Snapshot code is unexecuted evidence: label real validation status until exercised. Do not suspend app while Running or Ready to sync. If busy, defer sync visibly. Preserve DB/WAL together and use unique local destinations; do not combine old/new WAL. Prefer SQLite backup via vendor process in Stage 2.

Root shell is available; no `run-as` assumption. Exclude users/passwords from imports/API/logging. Never clear app storage, edit treadmill DB, force-stop vendor app, or delete history. Snapshot copying assumes the vendor process is sole writer and copying is inside bounded suspension; fail if copying exceeds the restoration deadline, do not import a questionable copy as complete.

Dashboard schema (migrations):

```text
machines(id PK, label, consoleSerial, dbGeneration, createdAt)
workouts(id PK, machineId, dbGeneration, recordId, userId, mode,
         distanceRaw, distanceKm NULL, unitProvenance, caloriesKcal,
         durationMs, createdUnixMs, importedAt,
         UNIQUE(machineId,dbGeneration,recordId))
live_sessions(id PK, machineId, startedAt, endedAt NULL, state,
              linkedWorkoutId NULL, source)
samples(id PK, liveSessionId, connectionEpoch, sequence, sampledAt,
        receivedAt, state, speedKph, inclinePercent, elapsedSeconds,
        distanceKm, caloriesKcal, pulseBpm NULL, qualityJson,
        UNIQUE(connectionEpoch,sequence))
commands(id PK, machineId, requestId UNIQUE, actionJson, state,
         requestedAt, sentAt NULL, completedAt NULL, resultJson)
sync_state(machineId,dbGeneration,lastRecordId,lastSyncAt)
```

Upsert imports in a transaction. Full initial sync; incremental recordId after that, with periodic full comparison. Detect database replacement (record high-water regression/identity mismatch); use a new generation and preserve old imports. A file hash is not a stable database identity: it changes on every workout. Machine identity derive from console serial if available (`getprop ro.serialno`), otherwise a persistent user-assigned UUID. Never use changing IP as identity.

Start live-session recording when observing Running, retain Paused gaps, finish on Normal after stop. If connecting mid-session, mark capture incomplete. Correlate saved workout by machine/user/duration/distance/time window, not by assuming recordId adjacency. When uncertain leave linkedWorkoutId null; never merge solely by timestamp. Store samples at 1 Hz and during state transitions; bound disk growth with documented retention/export, not silent deletion. Saved history has no pulse/speed/incline timeline; imported old workouts must show unavailable graphs.

Countdown in Stage 1 is a **display only** goal: remaining=max(0,targetSeconds-sessionElapsedSeconds), paused time frozen. Do not promise automatic stop based on browser timers. Vendor countdown mode was decoded but not physically validated; leave it out of this first release's controls.

## 8. Frontend behavior

- Connection settings panel: current connection address, pairing address/code, ADB path, connect/disconnect; explain different ports. Address change does not replace machine history.
- Live page: state, connection age, speed setting, incline, elapsed, distance, calories, pulse (dash when null), countdown display, reconnect messages.
- Controls: numeric low-range speed/incline, start/resume/pause, **Finish workout**, separate **Reset counters (brief belt movement)**. Show pending/confirmed/unknown states and disable duplicates. Capabilities drive visibility/disabled states.
- History: pagination, date/user/mode/duration/distance/calories; workout details and captured charts if available. Simple canvas/SVG charts suffice.
- Export CSV correctly escape strings, keep raw/unit provenance available.
- Responsive touch UI works at phone width and laptop width. No raw JDWP fields, packet offsets, or debugger jargon in normal workout controls; troubleshooting panel can show sanitized details.
- Offline demo is explicit labeled mode with a simulator; never replace live data silently when disconnected.

## 9. Implementation order and completion criteria

1. Scaffold server/static frontend/config/auth/storage and shared transport contract.
2. Implement ADB connection plus robust single-client JDWP telemetry.
3. Implement history sync and chartable sample recording.
4. Implement serialized guarded setters and raw key operations with confirmation.
5. Implement watchdog and Reset state machine; keep physical commands behind explicit actions.
6. Finish responsive UI, errors, README, startup/shutdown/reconnect cleanup.

Completion means: `npm install`, `npm start` documented; localhost dashboard works; phone access opt-in documented; endpoint editable; live fields/pulse normalized; no simultaneous JDWP clients; saved records imported without duplicates/passwords; command state honest; reset movement explicit; timers on console; clean disconnect removes own forwarding; Stage 2 can replace adapter without frontend/storage changes. Provide offline build/inspection steps and a separate user-attended verification checklist; do not execute physical checks unless requested.

Handoff must list changed files, run commands, hardware checks actually performed, unverified conditions, and next Stage 2 prerequisites. Do not call simulated checks proof of hardware behavior.
