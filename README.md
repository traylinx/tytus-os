# tytus-os

The next-generation Tytus desktop UI. Replaces the legacy "Tytus Tower" web page (vanilla HTML/JS bundled in `tytus-cli`) with a native-feeling web-OS shell.

```
services/tytus-os/
├── INTEGRATION-DEEPDIVE.md   ← architecture + 6-phase migration plan
└── app/                      ← TytusOS web shell (Vite/React/TS/Tailwind)
    └── README.md
```

Status: **Foundation cleaned 2026-04-28.** Boot/Login/Desktop/Dock/WindowManager working. 8 placeholder apps wait for their wiring phase. `tytus-cli` is frozen — all new UI work happens here.

Build/run from `app/`:

```bash
cd app && npm install && npm run dev
```
