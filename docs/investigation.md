# Treadmill investigation

## Confirmed device access

- Machine label: Ultimate Fitness Premium G700X.
- Console: Allwinner QUAD_CORE_A133_b6, Android 11.
- Firmware: V1.5.5-YJNP.
- Wireless ADB pairing and connection succeeded on 2026-10-10.
- Current connection: 192.168.10.18:41765 (may change).
- ADB executable: C:\Program Files\ASUS\GlideX\adb.exe.
- ADB shell runs as root on this firmware.

## Treadmill application

- Package: com.bodi.treadmill.
- APK: /oem/app/app-np-v1.5.5-16/app-np-v1.5.5-16.apk.
- Version code: 57.
- Application also serves as the Android home launcher.
- Its process has /dev/ttyAS2 open. This is a candidate for its motor-controller serial connection; the protocol has not been established.

## Workout history

- Database: /data/user/0/com.bodi.treadmill/databases/treadmill.
- Local snapshot includes treadmill, treadmill-wal, and treadmill-shm in investigation/history/console-databases/.
- The records table contains 552 rows at time of retrieval.
- Export: investigation/history/workout-history-raw.json and workout-history.csv.
- Fields: recordId, userId, mode, distance, calories, duration, created.
- CSV preserves numeric values and adds an ISO timestamp interpreted from created as Unix milliseconds.
- Duration appears to use milliseconds; distance units and mode meanings require confirmation from the application.
- A zero-distance record exists. Preserve records until their meaning is understood.
- Database also contains users, programs, and plans. The users table contains passwords; the exports include only workout records.
- Programs store speedValues, inclineValues, and programTime.

## Remaining work

- Analyze the APK to identify serial protocol, live telemetry, and possible app interfaces.
- Confirm record units, timestamp meaning, and user selection.
- Implement repeatable workout sync before conducting movement checks.
- Keep movement commands pending until their semantics and safety constraints are understood.

The investigation so far used read-only console inspection and copied files. No treadmill control commands were sent.

## Direct live session reading

- The app process is exposed through JDWP on this firmware.
- Forwarding: `adb -s 192.168.10.18:41765 forward tcp:8700 jdwp:1218`.
- `investigation/scripts/jdwp-read.mjs` implements an allowlist of metadata/value read commands and clean debugger detach. It sends no suspend, breakpoint, field-write, or method-invocation commands.
- Active service: `com.bodi.treadmill.service.RunnerService`; inherited field `AbsRunnerService.mRunner` points to a `NormalRunner` instance.
- Session fields are inherited from `BaseRunner`: mSpeed, mIncline, mDistance, mDuration, mCalorie, mLaps, mState, mStatus.
- Unit read from active `SerialComm.mUnit`: METRIC.
- Paused-session validation: mSpeed=10 corresponded to displayed 1.0 km/h; mDuration=38000 corresponded to 38 seconds; mDistance approximately 0.01; mIncline=0; mState matched enum constant Paused.
- `node investigation/scripts/poll-live.mjs 60 capture.jsonl` polls approximately once per second and writes JSON Lines plus live-telemetry-latest.json.
- The active runner is resolved once per capture. Restart capture after app restart, reconnection, or a new runner/session.
- This reads application state, not independently measured belt speed. Origins of each value in controller messages versus app calculations still require code analysis.
- Readings are taken without suspending the app; fields may change during collection, so this is not an atomic session snapshot.
- Initial three paused readings were stable; saved in paused-telemetry.jsonl.
- Moving-session validation succeeded: 136 samples over approximately three minutes in moving-telemetry.jsonl. Observed Paused -> Ready -> Running, speed 1.0 -> 2.0 km/h, distance 0.01 -> 0.06 km, elapsed time 38 -> 166 seconds, and calories 0 -> 2. Incline remained 0. The user operated the treadmill controls.
- No return to Paused was observed during that capture. Initial paused time/distance were stable, and running time/distance increased.
- Summary: telemetry-validation.json. Latest sample: live-telemetry-latest.json.

## First control test: speed change while paused

- User authorized changing speed or incline and explicitly prohibited starting the treadmill.
- Before test: Paused, 2.0 km/h, incline 0, distance 0.07 km, duration 191 seconds.
- Examined app bytecode in investigation/app/control-disassembly.txt before sending the setting.
- Speed shortcut callback calls RunnerService.setSpeed(value * 10), which delegates to BaseRunner.setValue(speed, existingIncline).
- setValue clamps values to configured bounds and calls SerialComm.postValue. It does not call ready, go, start, resume, or setKeyCode.
- ValueProtocol.setValues writes the setting command at byte 2, speed at byte 3, and incline at byte 4. Start/resume key commands use a separate field and path.
- Test action: ADB input taps opened the running screen speed shortcut popup and selected 1 km/h. This was remote UI control of the app's normal setter, not a standalone protocol client or direct method invocation.
- Six subsequent direct app readings confirmed speed 1.0 km/h, state Paused/status 7, incline 0, duration 191 seconds, and distance 0.07 km. Capture: after-speed-command.jsonl.
- BaseRunner.setValue does not assign mSpeed. Incoming ValueProtocol16 messages dispatch onDataChanged, which assigns mSpeed and mIncline. The readback is consistent with a controller response, not merely a local setter assignment; it still does not establish physically measured belt speed.
- No start/resume command was sent. The new speed setting was left at 1.0 km/h.

## Direct method control test

- User requested direct commands without simulated clicks. The earlier prohibition on starting/resuming remains in effect.
- Implemented direct-speed-command.mjs. It calls the active AbsRunnerService.setSpeed(I)V through JDWP ObjectReference.InvokeMethod, using the exact method and integer argument checked in the disassembly.
- The CLI permits only 1.0 to 2.0 km/h in 0.1 increments for this paused experiment. It verifies metric units and Paused/status 7 before invoking and again at the invocation point.
- JDWP method invocation requires an event-suspended thread. A one-shot Handler.dispatchMessage entry breakpoint filtered to the main thread establishes the invocation point; other threads, including the serial worker, remain running. The setter uses single-threaded invocation and the main thread is explicitly resumed afterward. Detach in finally clears outstanding debugger requests and suspension.
- The first attempt timed out without invoking because its count filter preceded the thread/location filters. A later attempt failed before invocation because subprocess creation was denied in this execution environment. Both detached; neither sent a speed command.
- Corrected the filter order and removed subprocess launching. The next call succeeded on 2026-10-10 at approximately 19:20 UTC.
- Requested direct speed change: 1.0 -> 1.5 km/h, argument 15. Method returned void with no exception.
- Six readback samples showed 1.5 km/h, incline 0, Paused/status 7, distance 0.07 km, elapsed time 191 seconds.
- Audit: investigation/telemetry/direct-speed-command-result.json and append-only direct-speed-command-audit.jsonl. No screen taps, raw serial writes, start/resume calls, or field modifications were used in the direct test.
- Current speed setting after the direct test: 1.5 km/h, still paused.
- Reuse while paused: establish the JDWP forwarding for the current app PID, then run `node investigation/scripts/direct-speed-command.mjs 1.5`. If the paused main thread has no messages, a separate read-only `adb shell dumpsys activity com.bodi.treadmill/.ui.RunningActivity` can wake it during the 30-second event wait. This script is a debugging prototype; a production bridge should avoid debugger-based control.

## Direct incline control test

- User authorized an incline change while the earlier no-start constraint remained in effect.
- Shared setting logic is now in investigation/scripts/direct-setting-command.mjs; investigation/scripts/direct-speed-command.mjs and investigation/scripts/direct-incline-command.mjs preserve simple separate CLI entry points.
- Reviewed AbsRunnerService.setIncline(I)V delegates to BaseRunner.setIncline, which calls setValue(existingSpeed, newIncline). This sends a setting command and does not issue start/resume.
- Requested incline 0 -> 1 through direct setIncline(1), without screen input.
- Readback showed incline 1, speed 1.5 km/h, Paused/status 7, distance 0.07 km, and elapsed time 191 seconds.
- Result/audit files: investigation/telemetry/direct-incline-command-result.json and direct-incline-command-audit.jsonl. Physical platform position has not been independently measured.
- The paused incline test CLI currently permits only values 0 and 1.
- User independently confirmed that the platform incline physically changed.

## Standalone hardware protocol access

- Decoded UART protocol and confirmed `/dev/ttyAS2`, 19200 baud, 8N1.
- Created a validated idle poll from the app's byte buffer; all setting/key fields were zero.
- Independently opened the UART from a standalone shell probe. The app was suspended for approximately 2.5 seconds with a cleanup trap and four-second restoration watchdog; ten idle polls were sent and raw replies captured.
- Received 208 bytes comprising 13 valid 16-byte controller frames, with no checksum failures. All decoded as Paused, speed setting 1.5 km/h, incline 1, elapsed 191 seconds, distance 0.07 km, calories 2 kcal, error 0.
- Vendor app restored after the probe. No standalone setting or start/resume command was sent.
- Protocol details: hardware-protocol.md. Guarded wrapper: standalone-serial-probe.ps1. Decoder: decode-serial.mjs.
- This proves independent access to the internal UART through console root/ADB; it does not expose a direct Wi-Fi/Bluetooth hardware API. A persistent external application needs a console bridge that coordinates UART ownership with the vendor app.

## Standalone serial speed change

- User authorized changing speed through the standalone hardware interface; no-start constraint retained.
- Confirmed Paused at 1.5 km/h and incline 1, then constructed a speed 1.0/incline 1 setting frame with key-code field zero and verified checksum.
- Packet: FD 01 01 0A 01 00 00 00 00 00 00 00 01 00 0E FE.
- Sent directly to /dev/ttyAS2 from investigation/scripts/standalone-serial-speed.sh while app suspended; no app method calls or screen input performed for control.
- 13 valid independent replies: two baseline speed 1.5, eleven speed 1.0. Every reply was Paused, incline 1, duration 191 seconds, distance 0.07 km, error 0. No checksum failures.
- Restored app; three subsequent direct app reads confirmed speed 1.0, incline 1, Paused, and unchanged session counters.
- Current setting: speed 1.0 km/h, incline 1, paused.
