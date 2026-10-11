# Stage 1 verification and setting latency review

Date: 2026-10-10. Scope: existing dashboard code, authenticated local API, read-only console polling comparison, focused regression tests. Original motor response was reported by the user; physical motor response after this patch has not been measured.

Rechecked 2026-10-11 before committing: all nine regression tests and seven live API checks passed. The user-run dashboard was connected with fresh Paused telemetry (speed 2 km/h, incline 1, elapsed 180 seconds) and imported history was accessible. No movement or setting commands were sent in this recheck. The core Stage 1 workflow is operational; the remaining review items below are still open.

## Cause and fix

Saved command records before the patch showed:

| Action | Dispatch latency | Java invocation | Confirmation from invocation |
| --- | --- | --- | --- |
| Set speed 1.2 km/h | 1620 ms | 15 ms | 4187 ms |
| Set incline 1 | 2617 ms | 14 ms | 4195 ms |

The code performed ReferenceType.Instances (JDWP 2:16) three times in **every** telemetry sample (service, serial connection, pulse handler), and once before every setter. This repeatedly scans the Android heap; doing it at the main-thread breakpoint also delays releasing the thread. The setter body itself was fast. Cached process object references remove those scans. The current service's mRunner and all state/units/counter/pulse values remain live reads.

Read-only comparison on the real paused console, using `dashboard/scripts/profile-telemetry.mjs`:

| Polling pattern | Samples | Mean | Range |
| --- | --- | --- | --- |
| Reproduced previous pattern: three heap scans per read | 3 | 1253.5 ms | 1114.3–1516.9 ms |
| Revised cached references | 8 | 98.9 ms | 47.5–253.7 ms |

Both patterns read Paused, 1.2 km/h, incline1, time163 seconds. No settings or movement were sent by this comparison. Raw result: `dashboard/data/telemetry-profile.json`. This proves a read-path improvement, not a completed measurement of motor response after a changed target.

## Other fixes made during verification

- Manual disconnect invalidates in-flight reads. Old completion cannot publish into a new connection, clear a new read lock, or trigger unwanted reconnect.
- Reconnect errors from old poll epochs are ignored.
- A possible setting delivery followed by failed readback becomes unknown, not misleadingly rejected.
- `armStopWatchdog({delayMs})` converts milliseconds to bounded whole seconds instead of interpreting milliseconds as seconds.

## Checks completed

- Nine focused offline regression tests pass (`npm test`): no routine heap scans; runner replacement; expired object handling; explicit-disconnect race; stale completions; read-lock ownership; cached setter invocation; watchdog unit conversion; unknown delivery classification.
- Modified modules passed Node syntax checks.
- Seven authenticated live API checks pass: dashboard static serving, anonymous rejection, login, config secret exclusion, cross-origin mutation rejection, saved-history listing, WebSocket initial status.
- Existing real console telemetry verified fresh Paused readings, and history API returned imported records.
- No Start/Resume/Pause/Stop/Reset or changed-target setting was sent during this verification.

The user restarted the dashboard and the patched process connected successfully. Explicit Disconnect remained disconnected during subsequent API checks, and reconnect succeeded. The initial profiling attempt on the old process had exposed the unwanted reconnect race described above.

Three authenticated same-value speed commands were confirmed on the real console, keeping it Paused at 1.2 km/h, incline 1, time 163 seconds, and distance 0.05 km:

| Trial | Dispatch | Setter invocation | Confirmation from invocation | Total API observation |
| --- | --- | --- | --- | --- |
| First after restart | 2293 ms | 30 ms | 1103 ms | 3557 ms |
| First after reconnect | 1118 ms | 122 ms | 1214 ms | 2504 ms |
| Repeated on the same connection | 174 ms | 14 ms | 1182 ms | 1468 ms |

The first setter on a connection still resolves setting metadata and waits for a main-thread Handler breakpoint. The repeated call avoids metadata discovery. Confirmation also deliberately waits for two matching telemetry reads, with 200 ms waits between attempts. These results show improved steady-state dispatch, but cold dispatch remains variable and physical changed-target response remains unmeasured. Same-value readback cannot establish hardware acknowledgement or motor response.

## Remaining review items (outside the latency patch)

1. Frontend disables Pause/Finish while another command is pending. Coordinator priorities remove queued work but do not interrupt an active setter/reset or snapshot. An emergency action cannot currently bypass that work; future improvement should explicitly implement interruption semantics and keep Stop accessible.
2. Watchdog ownership is tracked by one `activeWatchdog` property. Repeated independent Start/Resume watchdogs are not a complete durable timer registry, and reconnect can lose cancellation visibility. Review remote start → manual console pause → remote resume and process-restart recovery before relying on long unattended operation. No such movement scenario was tested here.
3. `GET /api/workouts/:id/samples` returns an empty list unconditionally; live sample graphs exist, but persisted workout-to-live-session correlation remains unimplemented.
4. Authenticated WebSocket connections are not tied to session expiry/logout on the server. UI closes its own socket, but server-side revocation still needs implementation.
5. `invalidCommands` is never pruned and live session state can span connection/machine changes; long-lived/multiple-machine behavior needs bounded cleanup and correlation checks.

The advertised wider speed/incline ranges and running-setting support were added at the user's request in earlier fixes. This review leaves those preferences intact; the latency patch does not independently validate those physical ranges.

## Next verification step

The restarted dashboard, API checks, disconnect/reconnect, and same-speed checks are complete. A user-attended changed-target speed/incline check is still needed to measure perceived motor response; do not substitute same-value confirmation for that evidence. For further dispatch profiling, separate metadata resolution, breakpoint wait, pre-invocation telemetry, and readback timings before choosing additional changes.
