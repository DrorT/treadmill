# G700X console/controller protocol

Observed on console firmware V1.5.5-YJNP, Android 11, Allwinner A133.

## Connection

- Serial endpoint inside the Android console: `/dev/ttyAS2`.
- Observed settings: 19200 baud, 8 data bits, no parity, 1 stop bit, raw mode, no software/hardware flow control.
- The vendor app normally polls every 200 ms and reads replies about every 195 ms.
- Root access through ADB can independently open the endpoint.
- The endpoint is an internal UART, not a discovered network/USB hardware service. A phone/laptop needs a bridge running on the console or separate physical UART access.
- Two readers on a UART compete for bytes. During the short standalone test the vendor app was suspended with SIGSTOP and restored with SIGCONT, preserving its session.

## Frame structure

The tested protocol uses 16-byte frames:

| Byte(s) | Meaning |
| --- | --- |
| 0 | Start marker `FD` |
| 1 | Frame type; normal poll/reply `01` |
| 2–13 | Direction-dependent payload |
| 14 | Sum of bytes 1 through 13, modulo 256 |
| 15 | End marker `FE` |

The app supports another protocol variant, but the live device used ValueProtocol16. This document does not establish compatibility with other firmware/models.

## Idle query transmitted in the test

```text
FD 01 00 00 00 00 00 00 00 00 00 00 01 00 02 FE
```

This was obtained from the current app output buffer, requiring all setting/key bytes to be zero, then recomputing its checksum. Byte 12 retains the app's logged-in flag. No setting, start/resume, calibration, or mode change was transmitted by the standalone probe.

## Controller reply

Example captured independently:

```text
FD 01 70 0F 01 00 BF 00 07 00 14 00 00 00 5B FE
```

| Byte(s) | Meaning | Example |
| --- | --- | --- |
| 2 high nibble | Controller status | 7 = Paused |
| 2 low nibble | Additional status passed to app callback; meaning unresolved | 0 |
| 3 | Speed setting in tenths of km/h in observed metric mode | 15 = 1.5 km/h |
| 4 | Incline value | 1 |
| 5–6 | Elapsed seconds, big endian | 191 |
| 7–8 | Distance in hundredths of km, big endian | 7 = 0.07 km |
| 9–10 | Calories in tenths of kcal, big endian | 20 = 2 kcal |
| 11 | Pulse value | 0 |
| 12 | Error code | 0 |
| 13 | Input code | 0 |

Observed status mapping from app code: 0 Normal, 1 Ready, 2 Running, 3 Stopping, 4 UnSafe, 5 Error, 6 Pausing, 7 Paused.

Controller-reported speed while paused is a retained speed setting, not actual moving-belt speed. Distance/calories/timing originate in controller replies; their underlying physical accuracy has not been independently measured.

## Setting format decoded from the app

- A normal setting frame uses type byte 1 = `01`, command byte 2 = `01`, desired speed at byte 3, desired incline at byte 4.
- Other command bytes are cleared; persistent login byte 12 is retained.
- Start/resume is handled through a separate key-code field at byte 13. The standalone probe keeps this byte zero.
- Speed/incline settings were successfully tested by calling the app methods directly. A standalone serial speed setting was subsequently confirmed, as described below.

## Standalone serial speed command: verified

With the controller paused at speed 1.5 km/h and incline 1, transmitted this packet directly to the UART:

```text
FD 01 01 0A 01 00 00 00 00 00 00 00 01 00 0E FE
```

This requests speed 1.0 km/h and retains incline 1. The key-code byte at offset 13 is zero. The shell sent this setting once between ordinary idle polls while the vendor app was temporarily suspended. It restored the app after approximately 2.5 seconds.

The independent capture contained 13 valid replies: the first two reported speed 1.5, and the next eleven reported speed 1.0. Every reply reported Paused/status 7, incline 1, time 191 seconds, distance 0.07 km, and error 0. All checksums passed. Three subsequent app reads confirmed the new setting and unchanged paused session.

Artifacts: investigation/scripts/standalone-serial-speed.sh, investigation/serial/serial-speed-command.bin, investigation/serial/serial-speed-capture.bin, investigation/serial/serial-speed-decoded.json, investigation/telemetry/before-raw-speed.jsonl, after-raw-speed.jsonl. The shell accepts only the exact tested packet; no generic arbitrary-command interface is exposed.

## Reproducible paused probe

Run `investigation/scripts/standalone-serial-probe.ps1` from this workspace with the current ADB device address and app PID if they change.

The wrapper confirms Paused/status 7, exports a validated idle frame, pushes the probe, captures replies, and checks the restored app. The on-device script sends ten idle polls at 200 ms intervals while independently reading the UART for 2.5 seconds. A cleanup trap and a four-second restoration watchdog resume the app.

Artifacts:

- `investigation/serial/serial-buffer-snapshot.json`: app buffer snapshot and validated poll bytes.
- `investigation/serial/serial-standalone-capture.bin`: 208 captured bytes.
- `investigation/serial/serial-decoded.json`: 13 valid independently captured replies; all checksums passed.
- `investigation/scripts/decode-serial.mjs`: standalone frame decoder.
- `investigation/scripts/standalone-serial-probe.sh`: bounded on-device probe.
- `investigation/telemetry/before-serial-probe.jsonl` and `investigation/telemetry/after-serial-probe.jsonl`: app telemetry around the probe.

For an ongoing bridge, coordinate UART ownership and polling with the vendor app. The short SIGSTOP handoff is a diagnostic technique, not an ongoing control architecture.

## Pulse sensor test: verified

On 2026-10-10, started through the raw UART at 1 km/h, incline 1. Read the controller-derived pulse via `CommandHandler.mPulse`, updated by the serial receive callback. Nonzero samples ranged from 73 to 82 bpm; moving samples ranged from 73 to 81. After a raw pause, state was Paused with duration 267 seconds and distance 0.09 km. Pulse returned to zero at 19:43:57 UTC; contact-loss timing was not independently confirmed. Capture: `investigation/telemetry/pulse-sensor-test.jsonl`. `investigation/scripts/poll-live.mjs` now includes `pulseRaw`. This validates availability of the sensor reading, not its measurement accuracy.
# Start and pause cycle, 2026-10-10

Sent raw UART start `fd0100000000000000000000014749fe` (key 0x47), with the console app continuing its normal polling. Telemetry changed Paused -> Ready -> Running at 19:37:41 UTC, speed 1 km/h, incline 1. Sent raw pause `fd0100000000000000000000015c5efe` (key 0x5c) after about 30 seconds; telemetry changed Pausing -> Paused by 19:38:15 UTC. Workout elapsed time rose from 191 to 224 seconds, distance from 0.07 to 0.08 km. Captures: `investigation/telemetry/start-cycle-running.jsonl` and `investigation/telemetry/start-pause-cycle.jsonl`. A device-side fallback pause was armed before start; the treadmill was confirmed paused. Timing included command delivery and deceleration (33 seconds added to the workout counter).
