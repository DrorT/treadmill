# Treadmill dashboard

Local Node.js dashboard for the G700X console. The application uses one ADB/JDWP connection, records live samples locally, and keeps all motion commands explicit. It never starts or resets the machine during startup, reconnect, or history browsing.

## Run

Use Node.js 24 or newer on Windows PowerShell:

```powershell
Set-Location D:\dev\treadmill\dashboard
npm install
npm start
```

Open `http://127.0.0.1:8080`. On first start, the app creates `data/config.json` with a random access token. Read that file locally and enter the token on the login page. “Remember this device” keeps an HttpOnly browser session for 30 days, including across server restarts; without it, the session lasts 12 hours and is not restored after a server restart. The token is never stored in the browser or served by the API. Back up the token securely; deleting the config creates a new one. SQLite data lives at `data/dashboard.sqlite`.

The initial ADB path is `C:\Program Files\ASUS\GlideX\adb.exe`. In Connection, enter the **current main Wireless debugging address and port** from the console. Pairing uses the separate short-lived pairing address, port, and code; the code is discarded after the pairing request. Save the main address, then connect. The device address is not used as the machine identity.

The server binds to `127.0.0.1` by default. To access it from a phone on the same trusted LAN, check “Allow phone access on my LAN”, save, and restart the server. Open `http://<laptop-LAN-address>:8080` on the phone and enter the same token. Configure the Windows firewall to permit the chosen port on the private network if required. Uncheck the option and restart to return to loopback access.

## Controls and safety behavior

Speed can be set from 0.0–20.0 km/h in 0.1 steps and incline from 0–15%, and can be changed while Running or Paused. Set speed to 0 only while Paused. Live setting changes were enabled at the user's request; controller behavior at these values has not been independently verified. Start and Resume arm a 120-second console-side Stop watchdog before sending a key. Pause, Finish, and setting changes require fresh telemetry and report success only after readback. A delivery or readback timeout is reported as unknown; do not resend until you inspect the machine and command state.

Reset counters is a separate operation that briefly moves the belt. It requires checking the acknowledgement and confirming the browser prompt. It arms an eight-second console-side Stop watchdog, starts/resumes once, stops as soon as Running is observed, and confirms Normal with zero elapsed time, distance, and calories in two samples. Do not use it without an attended session and a clear belt area. Finish does not reset counters.

Countdown is display-only. The UI does not schedule a stop from a browser timer. Speed displayed by the app is its commanded setpoint, not measured belt movement. Incline uses the vendor's percent display; no independent geometric calibration was performed. Offline demo data is not substituted for a disconnected machine.

## History and current validation limits

Live samples and session records are stored locally. Sync history is allowed only with fresh Normal or Paused telemetry. It briefly suspends the vendor app, copies the database plus matching WAL/SHM under a four-second on-console restore guard, and imports the recognized `records` schema transactionally. A failed or unrecognized snapshot is not imported. Full comparisons are used on each sync; a high-water regression or changed first-record identity creates a new generation while preserving earlier imports. The existing `workout-history-raw.json` is investigation evidence and is not imported automatically. Snapshot copies in `data/snapshots/` are retained; export or remove old copies manually after reviewing them. The dashboard does not silently delete data.

No physical movement checks or console database snapshots have been run by this implementation. The first connection performs read-only device discovery, inspects the app's current outgoing UART buffer to reject a pending command or non-metric login configuration, and reads telemetry. ADB writes occur only after an explicit command or an explicit History Sync request. Pairing, ADB service behavior, app debugger availability, helper upload permissions, UART frame delivery, watchdog execution/cancellation, database snapshot timing, and controller readback need user-attended confirmation on the target console.

## User-attended verification checklist

1. Place the treadmill in a clear area, remain at the console, and verify fresh Normal telemetry before trying Start.
2. Confirm Start uses the console watchdog and that Pause readback reaches Paused. Confirm a setting change is accepted only while Paused and the other setting/counters remain stable.
3. Confirm Finish reaches Normal. Verify the console watchdog is canceled after confirmed Pause or Finish.
4. Only if a brief belt movement is acceptable, use the separately acknowledged Reset action and observe the immediate stop and all three zero counters.
5. Disconnect and reconnect, confirming the old local JDWP forwarding is removed and no action is replayed.
6. Validate history snapshot copying separately while Normal or Paused before enabling database imports.

## Stage 2 prerequisites

Replace the transport adapter while retaining the normalized telemetry, action, coordinator, and SQLite contracts. Add a validated console-side database backup path, generation/replacement detection, incremental imports, workout-to-session correlation, retention/export policy, and hardware-verified watchdog recovery. Confirm debugger event cleanup under disconnect/timeouts and verify the vendor app's current login/pending-command byte interpretation against the console.

## Troubleshooting

If Node subprocess creation is blocked by a restricted shell, run `npm start` from ordinary user PowerShell. Do not switch to simulated telemetry. Check the sanitized Troubleshooting panel, the saved ADB executable path, the current main Wireless debugging endpoint, and console authorization. A server restart does not replay commands.

## Verification and setting latency fix (2026-10-10)

Repeated JDWP heap scans have been removed from live polling and setter dispatch. Stable service/serial/pulse objects are resolved at attachment; the active runner and all live values are still read on every sample. An expired object requires reattachment. Setters reuse the reader's service reference and do not scan the heap while main is suspended. A read-only on-console comparison measured the previous polling pattern at 1253.5 ms average and revised polling at 98.9 ms average; this is polling time, not a measured motor response time.

Explicit Disconnect now invalidates pending polls so their eventual completion/failure cannot republish old data or start automatic reconnection. Post-delivery setting readback failures are classified unknown rather than rejected. The watchdog adapter's `delayMs` contract now converts milliseconds to the shell helper's seconds.

Restart the existing server to load code changes. Then run:

```powershell
npm test
node scripts/verify-api.mjs check
```

The nine tests use fake device interfaces and a separate SQLite fixture under `test-results/`, not production commands/history. API checks authenticate locally without printing secrets, inspect live status/history/WebSocket, and check anonymous/cross-origin access rejection. They do not operate the treadmill. `node scripts/verify-api.mjs same-speed` is a separate explicit device check: it reapplies the current speed only while fresh Paused telemetry exists and verifies stable counters/settings. It invokes the real setter, so do not include it in unattended tests.

`scripts/profile-telemetry.mjs <local-forward-port>` reads the device only. Disconnect the dashboard before using it and remove your own forwarding afterward; never attach simultaneous JDWP clients. See `../docs/STAGE-1-VERIFICATION.md` for evidence and remaining review items.
