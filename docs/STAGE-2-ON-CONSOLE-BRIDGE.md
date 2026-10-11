# Stage 2 implementation brief: bridge running on the treadmill

Audience: luna-medium implementing after Stage 1. Read `STAGE-1-ADB-JDWP-DASHBOARD.md` first: its telemetry/actions/API/storage/coordinator contracts remain the contract. This document specifies the new transport and console deployment, not a dashboard rewrite.

## 1. Deliverable and architecture

Replace laptop ADB/JDWP runtime control with a service **resident on the Android console**. Laptop/dashboard communicates directly over LAN. Keep the vendor app installed, running, and the sole owner of UART polling/reading. ADB may be used to install/bootstrap; unplugging/stopping laptop ADB must not stop the resident bridge or its active watchdog.

Selected implementation: a JavaScript agent injected into the vendor process with an Android-native `frida-inject`, plus a root shell supervisor on the console. The agent reads the known Java objects and calls the app's existing methods on its main thread. It exposes an authenticated bounded TCP JSON-lines protocol. This is an in-process bridge; a separate ordinary APK cannot directly read another app's fields or private DB just because root ADB exists.

```text
browser <-> existing dashboard server + SQLite
                  <-> BridgeTransport (LAN TCP)
                           <-> resident agent inside com.bodi.treadmill
                                    <-> existing app serial owner
                                             <-> /dev/ttyAS2 controller
console root supervisor -> attach agent after vendor process restart
```

Why this choice: no permanent second UART reader, no serial takeover, no guessed controller startup sequence, no APK repackaging/signature change. The agent dies with the vendor process; supervisor reattaches with controls initially disabled until fresh telemetry.

**New prerequisite, not a confirmed discovery:** root injection compatibility and autonomous supervisor startup have not been tested on this firmware. Root ADB shell is verified; it does not prove SELinux allows injection or an ordinary APK has `su`. Complete the read-only attachment milestone first. If injection is blocked, report the exact error and leave Stage 1 usable; do not disable SELinux, flash firmware, install a rooting framework, modify vendor APK, or take over UART as an implicit fallback. There is no established stable public vendor API.

## 2. Known device/app data (no need to rediscover)

- Ultimate Fitness/Premium G700X; model K10.1FHD-N-ENS-AC; Allwinner A133 Android 11.
- Build RP1A.201005.006 test-keys; app firmware v1.5.5-yjnp, package `com.bodi.treadmill`, versionCode57.
- Root ADB works; IP/connection port/PID vary. Historical IP 192.168.10.18, PID1218 are not configuration constants.
- APK preserved as `treadmill-console.apk`; disassembly `control-disassembly.txt` and `reset-countdown-disassembly.txt`.
- Active service `com.bodi.treadmill.service.RunnerService`, inherited `AbsRunnerService.mRunner`.
- Runner `NormalRunner`/`BaseRunner`; fields speed integer tenths, incline integer, duration ms, distance km float, calories kcal float, laps, State enum, status integer.
- `SerialComm.mUnit` is METRIC in observed sessions; `CommandHandler.mPulse` bpm (0 unavailable).
- Status 0 Normal,1 Ready,2 Running,3 Stopping,4 UnSafe,5 Error,6 Pausing,7 Paused.
- UART `/dev/ttyAS2` 19200 8N1, active `ValueProtocol16`, polls200ms; leave ownership/configuration unchanged.
- History DB `/data/user/0/com.bodi.treadmill/databases/treadmill`; query only `records` (recordId,userId,mode,distance,calories,duration,created). Duration ms, created finish timestamp Unix ms. Historical unit unknown.
- Mode enum Manual0,Time1,Distance2,Calorie3,Program4,User5,Hrc6,UnKnown-1.
- Pulse73–82 verified. Saved history original552 records, later555; count is historical, not a limit.

## 3. Source layout and tooling

```text
bridge/
  package.json                  # build tooling only; not Node on Android
  package-lock.json
  README.md
  config.example.json
  agent/
    index.js
    protocol.js
    authentication.js
    vendor.js
    telemetry.js
    commands.js
    history.js
    watchdog.js
  scripts/
    install.ps1                 # ADB bootstrap, bounded and checked
    start-bridge.sh
    supervise-bridge.sh
    stop-bridge.sh
    uninstall.ps1
  dist/                         # compiled agent bundle, ignored builds
dashboard/server/transports/bridge.mjs
```

Use Frida official Android `frida-inject` artifact matching `getprop ro.product.cpu.abi` (do not infer ARM64 solely from the CPU model). Pin a compatible release and its checksum in README/manifest. Get artifacts from the official project release/source. If not supplied for the ABI, build from official source or report prerequisite unavailable; never select a random binary mirror.

Agent build imports `Java` from `frida-java-bridge`, bundles with `frida-compile` and a compatible pinned version. Since Frida17, Java bridge is not built into GumJS for arbitrary injected agents. Do not assume Node `fs/http/ws/crypto/sqlite` exists inside GumJS. Use Frida Socket/File APIs or Java classes. [Official Java bridge/API documentation](https://frida.re/docs/javascript-api/).

Native injector supports target PID, script file, and `--eternalize` to leave the script resident after injector exits; verify the selected binary's `--help` before deployment. [Official injector source](https://github.com/frida/frida-core/blob/main/inject/inject.vala).

## 4. Read-only deployment milestone (before any control)

1. Through existing ADB, read ABI, root identity, current app PID/version. Record supported exact firmware fingerprint, no hard-coded PID.
2. Build an agent that only locates RunnerService and returns a telemetry snapshot; no setters, start calls, field writes, or hooks that skip original methods.
3. Upload verified injector, agent bundle, config to `/data/local/tmp/treadmill-bridge/`; set executable mode on injector/scripts. Restrict config token file to owner read/write.
4. Inject into an already running vendor PID, not spawn a new vendor app. Example after validating flags:

```sh
app_pid=$(pidof com.bodi.treadmill)
/data/local/tmp/treadmill-bridge/frida-inject \
  -p "$app_pid" \
  -s /data/local/tmp/treadmill-bridge/agent.bundle.js \
  --eternalize
```

5. Agent must listen successfully, report expected firmware/service and read live state. Detach injector and shut down laptop ADB connections; read from LAN to prove residence. This is a read-only check, not permission to start the belt.
6. On app restart, old connection closes; supervisor reinjects once into new PID; a new connection epoch invalidates pending operations. Do not replay commands.

Class lookup may require the app class loader. Use `Java.perform`, `Java.choose('com.bodi.treadmill.service.RunnerService', callbacks)` once at attach, retain the service wrapper with `Java.retain`. Read the inherited runner dynamically every poll. Do not heap-scan every200ms or cache a runner forever. `Java.scheduleOnMainThread` runs reviewed app-method calls; catch errors and report no confirmation. [Official Java runtime API](https://frida.re/docs/javascript-api/).

## 5. Resident LAN protocol: concrete specification

Use direct TCP **port8766 configurable**, UTF-8 JSON Lines. This keeps the console implementation small; browser still uses the dashboard's existing WebSocket/HTTP. Agent socket API `Socket.listen({family:'ipv4',host:'0.0.0.0',port:8766})`, accept asynchronously, bounded input reads. [Official networking API](https://frida.re/docs/javascript-api/).

Initial scope is an explicitly configured trusted LAN. Bearer token authentication alone does not encrypt traffic; do not advertise TLS or internet-safe exposure. Bind localhost when LAN access disabled. Never expose Frida's general-purpose RPC/debug server remotely. Only the small application protocol is reachable.

Framing rules: newline-delimited JSON; buffer partial reads and split coalesced frames, max64KiB/frame and max256KiB/client pending buffer, at most4 clients, max32 queued requests, idle auth timeout5s, malformed/oversized frames close connection. Ordinary responses capped to page limits; write with proper backpressure, never on vendor main/UART thread. Enable TCP no-delay. All frames include `protocolVersion:1` and request/reply IDs. Protocol version mismatch rejects before commands.

Handshake:

```json
{"protocolVersion":1,"id":"a1","method":"hello","params":{"token":"secret","clientId":"dashboard-uuid"}}
{"protocolVersion":1,"replyTo":"a1","ok":true,"result":{"bridgeId":"persisted-uuid","connectionEpoch":"uuid","capabilities":{},"firmware":"v1.5.5-yjnp"}}
```

Token generated on laptop bootstrap using 32 random bytes; separate from dashboard cookie/access token. Provision restricted config; redact hello payload from logs; reject before exposing telemetry/history. Rotate token by redeploying config on paused/stopped console; no anonymous pairing endpoint. Use constant-time comparison via Java MessageDigest.isEqual, not normal string equality.

Root injector and injected code run with different filesystem access: the agent runs as the vendor UID. Provision its config/state under a bridge-specific subdirectory of the vendor app's private data directory, owned by the vendor UID, mode0700 directory/0600 files. Determine UID from installed package metadata; do not guess. Root-only injector/helper binaries/config stay in the bootstrap directory with root ownership. The agent needs its own credential to access the helper's localhost endpoint; provision that credential in its private config as well. Do not expect a root-owned mode0600 file to be readable by injected vendor code. Preserve all existing vendor-owned data.

Methods (only these; reject unknown keys and operations):

```text
getStatus {}                              -> connection + capabilities + latest sample
getTelemetry {}                           -> normalized fresh sample
subscribe {telemetryHz:1}                  -> ack, then events
unsubscribe {}
sendAction {commandId,action}             -> receipt only; later command event
getCommand {commandId}                    -> outcome/unknown
fetchHistory {afterRecordId,limit:100}      -> rows + pagination + dbGeneration
armStopWatchdog {operationId,delayMs}       -> ack + deadline
cancelStopWatchdog {operationId}           -> canceled/tooLate/notFound
shutdown {}                               -> only disable bridge, no vendor force-stop
```

Events: `{protocolVersion:1,event:'telemetry'|'command'|'connection',data:...}` using Stage1 data shapes. Agent owns a serialized action queue and confirmation even if laptop disconnects. `sendAction` accepts only Stage1 allowlist; public `reset` is coordinated by dashboard through start/resume/stop plus console watchdog, rather than implementing a second competing reset algorithm. Bridge primitive capabilities explicitly describe that reset choreography is available. Client cannot submit arbitrary method names, shell, file paths, Frida scripts, or packet bytes.

`BridgeTransport.sendAction` subscribes to bridge command outcomes and maps them into existing coordinator records; expose a consistent confirmation callback/event so coordinator does not send the same action twice. One authoritative timeout/outcome per operation: bridge verifies primitive operations; dashboard monitors and orchestrates compound reset. A lost reply returns unknown until command ID lookup reconciles it.

Keep idempotency cache for at least24h or last1000 command IDs, bounded persistent append-only log in app-private bridge subdirectory. Same ID+same action returns existing outcome; different action rejects. Persist received/sending marker before invocation. If process dies after marker, recovered outcome is unknown and must not execute again. An app restart must never replay a Start.

## 6. Vendor adapter implementation

### Telemetry

Use field lookup/reflection if Frida property access collides with method names. Values can be read with wrapper `.fieldName.value`; cast inherited types where needed. Normalize exactly as Stage1. `mState.value.toString()` or enum name gives State; read `mStatus` separately. Read current runner and unit each poll. Use uptime/monotonic timestamps for age/deadlines; ISO wall-clock timestamps for history/UI. Agent sample sequence and connectionEpoch reset only on agent initialization.

Publish1Hz steady telemetry; coordinator operations may sample200–500ms without forwarding every sample to all clients. Do not block app main thread with socket/database work or callbacks. Multiple-field sample remains non-atomic; report that quality honestly. Pulse0→null.

Optional error/input/status-low values remain null until explicit callback hooks are implemented and validated; no invented zero. Hooks must call original exactly once and must not replace the vendor app's own serial listener. Keep serial app ownership untouched.

### Commands

Known service methods on `AbsRunnerService`:

```text
setSpeed(int tenthsKph)
setIncline(int rawIncline)
start()
resume()
pause()
stop()
```

Use same low-range guards as Stage1 until expanded settings are validated. Setters direct JDWP invocation verified on hardware; start/resume/pause/stop method bodies were decoded, but this new injected invocation route is not hardware-verified. Review exact overloads from disassembly, preserve service state checks, and use fresh readback. `pause` only delegates in Running, `stop` in Running/Paused. `start` calls canStart then runner.ready; `resume` has own guards. A void return is not success.

Example pattern (illustrative, adapt lifecycle/thread/error handling):

```javascript
import Java from 'frida-java-bridge';
let service = null;
Java.perform(() => {
  Java.choose('com.bodi.treadmill.service.RunnerService', {
    onMatch(instance) { service = Java.retain(instance); return 'stop'; },
    onComplete() { /* mark attached only after successful telemetry */ }
  });
});
function requestSpeed(tenths) {
  Java.scheduleOnMainThread(() => {
    // Revalidate unit/state immediately here; limits checked beforehand too.
    service.setSpeed.overload('int').call(service, tenths);
    // Mark sent; subsequent telemetry must confirm the actual setting.
  });
}
```

Do not invoke private `clean`/`reset`, write runner fields, or silently fall back to raw UART after an app-method guard refuses. Preserve app workflow/history. Service destruction/classloader replacement invalidates wrappers; close controls and reattach.

Reset behavior already established: paused Stop alone may retain time/calories; Resume → Running → Stop can clear all three without prior resets, but briefly moves the belt. Preserve Stage1 reset acknowledgement, state machine, watch deadlines, and zero-counter verification. Do not hide motion inside Finish or call Stop before Running and assume it took effect.

### History in process

Use Java `android.database.sqlite.SQLiteDatabase.openDatabase` read-only on known DB path inside vendor UID, or the vendor Room DAO if its signatures are implemented from preserved code. Prefer direct read-only SQLite query with bound numeric arguments to avoid new DAO discovery. Query only records in a transaction/snapshot and paginate ordered by recordId; SQLite handles live WAL, no app SIGSTOP or ADB pull required.

Use a worker Java thread to run SQLite work, not vendor main/serial thread and not a long blocking GumJS timer. Keep cursor/DB close in finally. Never select users.password or all tables. Return raw column values, unit provenance, database generation. No destructive SQL. On full resync use same Stage1 generation/identity rules. Db generation should not change for every write or app restart; root supervisor provisions persistent bridge identity and app-owned config tracks generation separately.

## 7. Watchdogs and lifecycle

The bridge's in-process timer can fail with the vendor app. Add an independent **root supervisor-owned Stop watchdog**, started during bootstrap, with a private local authenticated control channel (e.g. localhost fixed port8767 with separate restricted token and same bounded JSONL parser). This helper is a small Android-native program compiled with the Android NDK; do not assume Python/Node is installed on the treadmill.

Native helper responsibilities only: supervise injected process attachment/health; arm/cancel timer; on expiration write the exact16-byte Stop frame once to `/dev/ttyAS2`; record result/deadline; preserve token/idempotency; respond on localhost. No second UART reader, no arbitrary packets/commands. Register timer in helper and receive ack **before** starting motion. Use monotonic deadline, mutex-protected cancellation so expired vs canceled is unambiguous, operation IDs, bounded minimum/maximum delays (1–120 seconds initially). A shell sleep can be used for an early prototype only if cancellation and process-crash behavior are proved; don't call an in-agent timeout independent.

Known Stop packet with logged-in1: `FD010000000000000000000001484AFE`. On fatal bridge/vendor death during an armed operation, helper attempts Stop once (and bounded follow-up if necessary), retains a fault record, never Start. Stop during Ready may be ineffective: if a Start operation has not reached Running, retain a second stop deadline after countdown instead of canceling on premature Normal/Ready observations. Report lack of hardware confirmation; helper must not claim "stopped" merely because write succeeded.

Supervisor tracks exact numeric PID, attaches only once per PID after health probe, exponential retry/backoff, bounded logs. Do not force-stop/restart vendor app to "fix" injection while moving. Agent reinjection/update only while Normal/Paused; shutdown agent socket/retained references deliberately, preserve vendor functionality. Do not inject duplicates into the same process if health briefly stalls; existing listener/bridgeId guard should reject second agent initialization.

Bootstrap is possible through root ADB on this firmware. Reboot persistence is a separate prerequisite: no verified Magisk, su, init.d, privileged app install, or vendor startup hook exists in our evidence. Initial delivery must document **manual ADB bootstrap after console reboot**, while remaining independent of laptop ADB during that boot session. A shell loop surviving app restart is not reboot persistence. Implement an approved boot mechanism only once its availability is established; never claim auto-start after reboot based on nohup.

## 8. Dashboard changes

Add `bridge` transport selection, configured hostname/IP and TCP port8766, bridge secret provisioned locally, expected bridgeId. Keep existing dashboard API/frontend/database. Connection settings should separate ADB bootstrap information from normal bridge address. Manual address update is required baseline; optional mDNS discovery only if implemented end to end. A hostname/mDNS name is not established by our investigation, so don't assume it exists.

Check bridge identity/version/capabilities at hello. If a different bridge appears at same IP, require explicit selection instead of merging histories. Connection loss/stale telemetry blocks new motion; reauthenticate/resubscribe with backoff; reconcile command IDs; no replay. Display bridge timer deadlines and stale/unknown command outcomes. Preserve ADB adapter as an explicit fallback transport, never auto-switch transports in a running session.

## 9. Implementation order and acceptance

1. Build/install the read-only agent and prove local native injection/retention on this console. Record ABI/runtime versions and any errors. This is the only new platform prerequisite; do not repeat UART discovery.
2. Implement authenticated JSONL protocol, telemetry normalization, reconnect/identity, and new dashboard adapter.
3. Implement read-only paginated history via SQLite; preserve originals.
4. Build native watchdog helper; bootstrap/supervisor lifecycle and cancellation semantics.
5. Add app-method primitive commands and confirmation. Retain unsupported capability flags until user-attended checks establish new invocation behavior.
6. Connect the existing Reset coordinator and verify its new transport dependency semantics, without duplicating reset logic.
7. Document deployment, startup after reboot, update/uninstall, and exactly what remains unverified.

Acceptance: dashboard reads real telemetry/history without runtime ADB/JDWP; vendor UI continues normally; no additional UART reader; only reviewed commands accepted; token required; bounded protocol; duplicate command ID never moves twice; independent watchdog survives laptop/agent loss; reconnect never starts treadmill; Stage1 storage/UI still work; manual reboot bootstrap limitation disclosed. Hardware acceptance is user-attended and requested explicitly; software installation alone is not authorization to move the belt.

Uninstall stops/removes only bridge/helper files/processes, not vendor package/data. Require no firmware flash, app resigning, bootloader change, or disabled SELinux. If local injection unavailable, complete the adapter/protocol/artifacts you can and report the real deployment blocker; do not invent successful hardware validation or a public vendor API.
