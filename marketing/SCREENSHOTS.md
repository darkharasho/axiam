# Marketing screenshots

The marketing site references these images in `assets/screenshots/`:

| File | What to capture |
|------|-----------------|
| `hero-app.png` | The main account vault — several accounts, master password unlocked. Wide aspect (the hero shows it large). |
| `vault.png` | Same vault view but cropped tighter. |
| `master-password.png` | The master password unlock prompt on first launch. |
| `account-edit.png` | The "Edit account" modal with launch args + optional API key field. |
| `launching.png` | An account card mid-launch with the live status indicator. |
| `whats-new.png` | The What's New screen shown after an update. |
| `settings.png` | Settings panel with GW2 path, theme picker, master-password cadence. |

## How to capture

The app has a built-in showcase mode that loads fake accounts, simulated running states, and fake updater / What's New content:

```bash
npm run dev:showcase
```

From there:
1. Resize the window to ~1280×800 for a clean aspect ratio.
2. Use your OS screenshot tool to capture each view above.
3. Save into `marketing/assets/screenshots/` using the filenames in the table.
4. PNGs ~1600px wide compress well — no need to go higher.

The site uses `loading="lazy"` for everything except the hero, so missing images will leave broken icons but won't block the rest of the page.
