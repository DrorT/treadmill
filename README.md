# Treadmill integration

Android console integration for the Premium G700X / Ultimate Fitness treadmill.

## Project layout

- [dashboard/](dashboard/README.md): Stage 1 application, server, frontend, tests, and development scripts. Runtime config, credentials, and databases stay in ignored `dashboard/data/`.
- [docs/](docs/TREADMILL-INTEGRATION-GUIDE.md): integration guide, hardware protocol, investigation notes, stage plans, and verification results.
- [investigation/](investigation/README.md): discovery scripts and local evidence, grouped by type.
- `tools/`: local investigation dependencies and temporary package downloads; ignored by Git.

## Run the dashboard

```powershell
cd dashboard
npm install
npm start
```

Open the address printed by the server. See the dashboard README for pairing, the current wireless debugging endpoint, authentication, and controls.
