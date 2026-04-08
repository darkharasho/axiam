# <img width="42" height="47" alt="AxiAM" src="https://github.com/user-attachments/assets/1c349236-c3ca-4f1a-9882-6d91b86a2c0d" /> AxiAM

A desktop account launcher focused on speed, security, and clean multi-account workflow.

## User Features
- **Secure account vault**: credentials are encrypted locally with a master password.
- **Multi-account management**: add, edit, and organize as many accounts as you need.
- **One-click launch flow**: launch accounts through Steam integration with managed arguments.
- **Per-account launch options**: keep custom launch args without manually retyping each session.
- **Start/stop visibility**: clear running/launching/stopping status per account.
- **Auto-updater UX**: animated update indicator, in-app restart when update is ready.
- **What’s New screen**: first launch after update can show release notes in-app.
- **Theme support**: switch visual themes from settings.
- **GW2 API key support (optional)**: resolve account profile metadata in the UI.
- **Built-in links**: quick access to project Discord and GitHub from settings.

<img width="383" height="551" alt="image" src="https://github.com/user-attachments/assets/9ca66ffd-1bba-43b0-a01f-42698b21fee2" />


## Quick Start
### Install
```bash
npm install
```

### Run in development
```bash
npm run dev
```

### Test update/What’s New flow locally
```bash
npm run dev:update
```

### Showcase mode (fake data for screenshots)
```bash
npm run dev:showcase
```
Starts with fake accounts, simulated running states, and fake updater/What&apos;s New content for demos and screenshots.

### Build desktop release locally
```bash
npm run electron:build
```
Artifacts are generated in `dist_out`.

## Release Workflow
### Build and publish GitHub release
Set `GITHUB_TOKEN` (or `GH_TOKEN`) and `OPENAI_API_KEY`:
```bash
npm run build:github
```
For Windows trust, also configure code signing in your environment:
- `CSC_LINK`: path/URL/base64 for your `.p12`/`.pfx` signing certificate
- `CSC_KEY_PASSWORD` (or `WIN_CSC_KEY_PASSWORD`): certificate password

Without signing, Windows Smart App Control and SmartScreen will commonly block the installer.

### Bump version + publish (patch/minor/major)
```bash
npm run build:github -- patch
```
This flow bumps version, updates lockfile, generates AI release notes, commits release files, builds artifacts, and publishes release assets.

### Non-interactive release notes approval
```bash
RELEASE_NOTES_AUTO_APPROVE=1
```

### Unsigned test builds (not recommended)
```bash
AXIAM_ALLOW_UNSIGNED_WINDOWS=1 npm run build:github
```
Use this only for local testing. Unsigned Windows binaries are expected to be flagged.

## Configuration
- **Master Password**: set on first launch. If forgotten, resetting app data resets stored accounts.
- **GW2 Path**: set path to `Gw2-64.exe` (Linux can use a wrapper script).
- **Prompt cadence**: choose when the master password is required again.

## Architecture

AxiAM is built with **Electron + React 18 + TypeScript** on the frontend and a Node.js main process handling system-level operations.

```
src/
  App.tsx              # Main React application component
  components/          # React components (modals, cards, UI elements)
  themes/              # Theme definitions and application logic
  types.ts             # Shared TypeScript types
electron/
  main.ts              # Electron main process (IPC, file I/O, updater)
  preload.cts          # Context bridge for secure IPC
  store.ts             # Persistent settings and account storage
  crypto.ts            # Encryption utilities
```

- **UI**: React 18 with Tailwind CSS and a custom glassmorphic design system
- **Encryption**: AES-256-GCM via Node.js `crypto` module, keyed from the master password
- **Auto-updater**: electron-updater with GitHub Releases as the update source
- **Build tooling**: Vite for dev/bundling, electron-builder for packaging

## Contributing

1. Fork the repo and create a feature branch from `main`.
2. Follow existing code style — React functional components with TypeScript.
3. Write clear commit messages (conventional commits preferred).
4. Run `npm run dev` and manually verify your changes before opening a PR.
5. Open a PR against `main` with a description of what changed and why.

Please keep PRs focused — one feature or fix per PR. If you're unsure about a larger change, open an issue first to discuss.

## FAQ

**Q: I forgot my master password. Can I recover my accounts?**
A: No. The master password is never stored and cannot be recovered. You'll need to reset app data and re-add your accounts.

**Q: Does AxiAM store my credentials online?**
A: No. All credentials are encrypted and stored locally on your machine. Nothing is transmitted to any server.

**Q: Can I use AxiAM on Linux?**
A: Yes. Point the GW2 path to a wrapper script that launches the game through Proton/Wine. The rest of the app works natively.

**Q: The app says an update is available but nothing happens.**
A: Check your internet connection and firewall settings. Updates are downloaded from GitHub Releases. If the issue persists, download the latest installer manually.

**Q: Why does Windows SmartScreen warn me about the installer?**
A: Unsigned builds trigger SmartScreen warnings. Official releases are code-signed to avoid this. If you built from source without a signing certificate, this is expected.

## License

This project is licensed under the [MIT License](LICENSE).

## Project Links
- Discord: `https://discord.gg/UjzMXMGXEg`
- GitHub: `https://github.com/darkharasho/axiam`
