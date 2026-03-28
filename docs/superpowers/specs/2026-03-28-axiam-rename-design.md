# AxiAM Rename Design

Full rename of the project from "GW2AM" / "GW2 Account Manager" to "AxiAM", aligning branding with the axibridge and axiforge family.

## 1. Package & Metadata

| Field | Old | New |
|-------|-----|-----|
| `name` | `gw2-account-manager` | `axiam` |
| `appId` | `com.gw2am.app` | `com.axiam.app` |
| `productName` | `GW2 Account Manager` | `AxiAM` |
| `artifactName` | `GW2AM-${version}-...` | `AxiAM-${version}-...` |
| `repo` (build.publish) | `GW2AM` | `axiam` |
| Window title (index.html) | `GW2 Account Manager` | `AxiAM` |

## 2. Branding & Typography

**Font:** Add Cinzel (weights 500, 700) from Google Fonts, matching axibridge/axiforge.

**Title bar:** Replace `<img src="img/GW2AM.png">` with styled HTML text using Cinzel at `letter-spacing: 0.06em`. White "Axi" + deep red "AM".

**Brand color:** Deep red for the "AM" accent (e.g. `#8B1A1A` or similar — final value chosen during implementation).

**Watermark:** CSS class `.gw2am-mark` → `.axiam-mark`. SVG mask updated to reference `AxiAM.svg`.

**Image files renamed:**
- `GW2AM.png` → `AxiAM.png`
- `GW2AM.svg` → `AxiAM.svg`
- `GW2AM-square.png` → `AxiAM-square.png`

The SVG and PNG content needs to be regenerated/updated to reflect the new name. The title bar will use HTML text instead of the PNG, so `AxiAM.png` is only needed for contexts that still reference it (e.g. square icon for Electron).

## 3. Internal Identifiers

**Environment variables** — all `GW2AM_` → `AXIAM_`:
- `AXIAM_DEV_FAKE_UPDATE`
- `AXIAM_DEV_FAKE_WHATS_NEW`
- `AXIAM_DEV_FAKE_GW2_UPDATE`
- `AXIAM_DEV_SHOWCASE`
- `AXIAM_ALLOW_UNSIGNED_WINDOWS`
- `AXIAM_BUILD_ALL`

**App model ID:** `com.gw2am.app` → `com.axiam.app`

**Mumble link names:** `gw2am_${accountId}` → `axiam_${accountId}`

**Log format:** `[GW2AM][Main][${scope}]` → `[AxiAM][Main][${scope}]`

**Diagnostics:**
- Folder: `GW2AM-Diagnostics` → `AxiAM-Diagnostics`
- File: `gw2am-diagnostics-${stamp}.txt` → `axiam-diagnostics-${stamp}.txt`
- Header: `GW2 Account Manager Diagnostics` → `AxiAM Diagnostics`

**User-Agent:** `GW2AM-Updater` → `AxiAM-Updater`

**CSS class:** `.gw2am-mark` → `.axiam-mark`

## 4. GitHub URLs & Documentation

**Hardcoded GitHub URLs** updated to `darkharasho/axiam`:
- Settings modal link
- API release URL in main.ts
- README links

**README.md:** Title updated to "AxiAM".

**Release notes prompt** in `generate-release-notes.mjs`: `"GW2 Account Manager"` → `"AxiAM"`.

**Existing design docs** (e.g. `2026-03-28-local-dat-swap-design.md`): Left as-is — historical records.

## 5. Out of Scope

- Renaming the GitHub repository itself (done manually on GitHub)
- Renaming the local directory on disk
- Updating CI/CD workflows (if any reference the old name)
- Changing the build icon artwork (icon.png, icon.ico) — these are geometric, not text-based
