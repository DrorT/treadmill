# Investigation archive

These are the original discovery utilities and captures. The dashboard uses its own implementation and does not depend on these files at runtime.

| Folder | Contents |
| --- | --- |
| `scripts/` | JDWP readers, setters, serial decoding, disassembly tools, and on-console shell experiments |
| `telemetry/` | Live snapshots, command audits, before/after captures, and console logs |
| `serial/` | UART frames, binary captures, and decoded protocol snapshots |
| `screenshots/` | Console screenshots |
| `history/` | Workout exports and original database/WAL snapshots |
| `app/` | Vendor APK, extracted DEX files, disassembly, and string inventory |

Scripts and this index are versioned. Captures, vendor binaries, database copies, and `moved-paths.json` (the old-to-new path inventory) remain local and ignored. Original captures are preserved.

## Script paths

Run Node/Python scripts by their path from the repository root. They set their working directory to `investigation/`, so explicit input/output arguments are relative to that directory, or may be absolute. Default output paths point to the matching archive subfolder. Node imports remain relative to `scripts/`.

```powershell
node investigation/scripts/decode-serial.mjs serial/serial-standalone-capture.bin serial/independent-decoded.json
```

Python disassembly uses `app/` and dependencies in `../tools/tool-deps/`. The PowerShell serial probe sets its own working directory and resolves its scripts and captures in this layout. Shell experiments run on the console and retain their original `/data/local/tmp/` paths.

Some scripts send hardware commands or briefly move the treadmill. Read the script and [integration guide](../docs/TREADMILL-INTEGRATION-GUIDE.md) before intentionally running them. Historical defaults such as endpoint ports and app PIDs must be checked against the current device.
