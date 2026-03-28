# Local.dat Swap Authentication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace UI automation credential entry with per-account Local.dat file swapping + `-autologin` for instant, permission-free GW2 login.

**Architecture:** New `electron/localDat.ts` module handles resolving platform-specific GW2 data paths, copying Local.dat to/from per-account storage in the app's userData directory. The launch flow in `electron/main.ts` swaps the file before spawning. A new "Save Login" button on AccountCard triggers the save via IPC. No new dependencies.

**Tech Stack:** Electron (Node.js fs), React, TypeScript, IPC

**Spec:** `docs/superpowers/specs/2026-03-28-local-dat-swap-design.md`

---

### Task 1: Create Local.dat utility module

**Files:**
- Create: `electron/localDat.ts`

This module provides all Local.dat operations: resolve GW2 data directory, save/restore per-account copies, check existence.

- [ ] **Step 1: Create `electron/localDat.ts` with path resolution**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const STEAM_APP_ID = '1284210';

/**
 * Returns the directory where GW2 stores Local.dat.
 * - Linux: Wine prefix inside Steam compatdata
 * - Windows: %AppData%\Guild Wars 2
 */
export function getGw2DataDirectory(): string | null {
  if (process.platform === 'linux') {
    const home = app.getPath('home');
    const candidate = path.join(
      home, '.local', 'share', 'Steam', 'steamapps', 'compatdata',
      STEAM_APP_ID, 'pfx', 'drive_c', 'users', 'steamuser',
      'AppData', 'Roaming', 'Guild Wars 2',
    );
    return fs.existsSync(candidate) ? candidate : null;
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    const candidate = path.join(appData, 'Guild Wars 2');
    return fs.existsSync(candidate) ? candidate : null;
  }

  return null;
}

/** Returns the path to the live Local.dat, or null if it doesn't exist. */
export function getLocalDatPath(): string | null {
  const dir = getGw2DataDirectory();
  if (!dir) return null;
  const filePath = path.join(dir, 'Local.dat');
  return fs.existsSync(filePath) ? filePath : null;
}

/** Directory where per-account Local.dat copies are stored. */
function getStorageDir(): string {
  return path.join(app.getPath('userData'), 'local-dat');
}

/** Returns the storage path for a given account's Local.dat copy. */
function getAccountLocalDatPath(accountId: string): string {
  return path.join(getStorageDir(), `${accountId}.dat`);
}

/** Check if a saved Local.dat exists for an account. */
export function hasLocalDat(accountId: string): boolean {
  return fs.existsSync(getAccountLocalDatPath(accountId));
}

/**
 * Save the current GW2 Local.dat as this account's copy.
 * Returns { success, message }.
 */
export function saveLocalDat(accountId: string): { success: boolean; message: string } {
  const sourcePath = getLocalDatPath();
  if (!sourcePath) {
    return { success: false, message: 'Local.dat not found. Log into GW2 first, then try again.' };
  }

  const storageDir = getStorageDir();
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  const destPath = getAccountLocalDatPath(accountId);
  fs.copyFileSync(sourcePath, destPath);
  return { success: true, message: 'Login saved successfully.' };
}

/**
 * Restore an account's Local.dat into the GW2 data directory.
 * Returns true if the file was placed, false if no saved copy or no target dir.
 */
export function restoreLocalDat(accountId: string): boolean {
  const destDir = getGw2DataDirectory();
  if (!destDir) return false;

  const sourcePath = getAccountLocalDatPath(accountId);
  if (!fs.existsSync(sourcePath)) return false;

  const destPath = path.join(destDir, 'Local.dat');
  fs.copyFileSync(sourcePath, destPath);
  return true;
}

/**
 * Delete a saved Local.dat for an account.
 */
export function deleteLocalDat(accountId: string): void {
  const filePath = getAccountLocalDatPath(accountId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: No errors related to `electron/localDat.ts`

- [ ] **Step 3: Commit**

```bash
git add electron/localDat.ts
git commit -m "feat: add Local.dat utility module for per-account auth storage"
```

---

### Task 2: Add IPC handlers for Local.dat operations

**Files:**
- Modify: `electron/main.ts` — add IPC handlers
- Modify: `electron/types.ts` — add IPC event types

- [ ] **Step 1: Add IPC types to `electron/types.ts`**

Add to the `IpcEvents` type:

```typescript
'save-local-dat': (accountId: string) => Promise<{ success: boolean; message: string }>;
'has-local-dat': (accountId: string) => Promise<boolean>;
'delete-local-dat': (accountId: string) => Promise<boolean>;
```

- [ ] **Step 2: Add IPC handlers to `electron/main.ts`**

Add the import at the top of the file alongside other imports:

```typescript
import { saveLocalDat, hasLocalDat, deleteLocalDat } from './localDat.js';
```

Add these handlers near the other `ipcMain.handle` registrations (e.g., after the `export-diagnostics` handler):

```typescript
ipcMain.handle('save-local-dat', async (_, accountId: string) => {
  return saveLocalDat(accountId);
});

ipcMain.handle('has-local-dat', async (_, accountId: string) => {
  return hasLocalDat(accountId);
});

ipcMain.handle('delete-local-dat', async (_, accountId: string) => {
  deleteLocalDat(accountId);
  return true;
});
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/types.ts
git commit -m "feat: add IPC handlers for Local.dat save/check/delete"
```

---

### Task 3: Expose Local.dat IPC in preload bridge

**Files:**
- Modify: `electron/preload.cts`

- [ ] **Step 1: Add Local.dat methods to the preload bridge**

Add these methods inside the `contextBridge.exposeInMainWorld('api', { ... })` object, after the `startGw2Update` line:

```typescript
saveLocalDat: (accountId: string) => ipcRenderer.invoke('save-local-dat', accountId),
hasLocalDat: (accountId: string) => ipcRenderer.invoke('has-local-dat', accountId),
deleteLocalDat: (accountId: string) => ipcRenderer.invoke('delete-local-dat', accountId),
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add electron/preload.cts
git commit -m "feat: expose Local.dat IPC methods in preload bridge"
```

---

### Task 4: Modify launch flow to use Local.dat swap

**Files:**
- Modify: `electron/main.ts` — the `launch-account` handler

- [ ] **Step 1: Add restoreLocalDat import**

Update the existing import from step 2 to also include `restoreLocalDat`:

```typescript
import { saveLocalDat, hasLocalDat, deleteLocalDat, restoreLocalDat } from './localDat.js';
```

- [ ] **Step 2: Replace credential CLI args with Local.dat swap**

In the `launch-account` handler, replace the current args construction block:

```typescript
  const extraArgs = splitLaunchArguments(account.launchArguments);
  const sanitizedExtraArgs = stripManagedLaunchArguments(extraArgs);
  const mumbleName = getAccountMumbleName(account.id);
  const passwordForArgs = decrypt(account.passwordEncrypted, masterKey);
  const args = [
    '--mumble', mumbleName,
    '-email', account.email,
    '-password', passwordForArgs,
    '-autologin',
    ...sanitizedExtraArgs,
  ];
```

With:

```typescript
  const extraArgs = splitLaunchArguments(account.launchArguments);
  const sanitizedExtraArgs = stripManagedLaunchArguments(extraArgs);
  const mumbleName = getAccountMumbleName(account.id);

  // Swap Local.dat if available — enables -autologin (no UI automation needed)
  const hasAuth = restoreLocalDat(account.id);
  if (hasAuth) {
    logMain('launch', `[local-dat] Restored Local.dat for account=${id}, using -autologin`);
  } else {
    logMain('launch', `[local-dat] No saved Local.dat for account=${id}, launching without -autologin`);
  }

  const args = [
    '--mumble', mumbleName,
    ...(hasAuth ? ['-autologin'] : []),
    ...sanitizedExtraArgs,
  ];
```

- [ ] **Step 3: Remove the now-unused experimental log line and comment block**

Delete these lines that come after the try/catch (the commented-out automation block):

```typescript
  // Experimental: try passing credentials via command-line args
  // If GW2 honours these, the launcher auto-fills and submits — no UI automation needed
  logMain('launch', `[cli-auth] Injecting -email/-password/-autologin args for account=${id}`);

  // UI automation disabled while testing CLI-arg / Local.dat approaches
  // launchStateMachine.setState(id, 'credentials_waiting', 'inferred', 'Waiting before credential automation');
  // ...entire commented block...
  // launchStateMachine.setState(id, 'credentials_submitted', 'inferred', 'Credential automation started');
```

- [ ] **Step 4: Remove the now-unused `passwordForArgs` decrypt call and password log filtering**

The `console.log` lines that filter `passwordForArgs` should revert to simple logging since there's no password in the args anymore:

```typescript
      console.log('Launching direct executable:', args.join(' '));
```

and:

```typescript
      console.log('Launching via Steam:', args.join(' '));
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat: swap Local.dat before launch instead of passing credential args"
```

---

### Task 5: Add "Save Login" button to AccountCard

**Files:**
- Modify: `src/components/AccountCard.tsx`

- [ ] **Step 1: Add new props for Local.dat state**

Update the `AccountCardProps` interface:

```typescript
interface AccountCardProps {
    account: Account;
    onLaunch: (id: string) => void;
    onStop: (id: string) => void;
    onSaveLogin: (id: string) => void;
    isActiveProcess: boolean;
    hasLocalDat: boolean;
    status: 'idle' | 'launching' | 'running' | 'stopping' | 'errored';
    statusCertainty?: 'verified' | 'inferred';
    accountApiName: string;
    isBirthday: boolean;
    onEdit: (account: Account) => void;
}
```

- [ ] **Step 2: Add the Save Login button to the card**

Update the component destructuring to include the new props:

```typescript
const AccountCard: React.FC<AccountCardProps> = ({ account, onLaunch, onStop, onSaveLogin, isActiveProcess, hasLocalDat: hasAuth, status, statusCertainty, accountApiName, isBirthday, onEdit }) => {
```

Add the `Save` import from lucide-react:

```typescript
import { Loader2, Play, Save, Settings, Square } from 'lucide-react';
```

Add the Save Login button between the launch/stop button and the edit button:

```typescript
                <button
                    onClick={() => onSaveLogin(account.id)}
                    className={`p-1.5 rounded-md transition-colors ${
                        hasAuth
                            ? 'bg-[var(--theme-active-ring)] text-[var(--theme-text)]'
                            : 'bg-[var(--theme-control-bg)] hover:bg-[var(--theme-control-hover)] text-[var(--theme-text)]'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                    title={hasAuth ? 'Login saved — click to re-save' : 'Save Login (log in manually first)'}
                    disabled={isActiveProcess || status === 'launching' || status === 'stopping'}
                >
                    <Save size={16} />
                </button>
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Errors in `App.tsx` about missing props (expected — we'll fix in next task)

- [ ] **Step 4: Commit**

```bash
git add src/components/AccountCard.tsx
git commit -m "feat: add Save Login button to AccountCard"
```

---

### Task 6: Wire up Local.dat state and handlers in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add Local.dat state tracking**

Add state near the other account-related state declarations:

```typescript
const [accountHasLocalDat, setAccountHasLocalDat] = useState<Record<string, boolean>>({});
```

- [ ] **Step 2: Load Local.dat status when accounts load**

After accounts are loaded (inside the `loadAccounts` function, after `setAccounts(loadedAccounts)`), add a check for each account:

```typescript
      const localDatStatus: Record<string, boolean> = {};
      for (const acc of loadedAccounts) {
        localDatStatus[acc.id] = await window.api.hasLocalDat(acc.id);
      }
      setAccountHasLocalDat(localDatStatus);
```

- [ ] **Step 3: Add the handleSaveLogin handler**

Add this near the other account action handlers (`handleLaunch`, `handleStop`, etc.):

```typescript
    const handleSaveLogin = async (id: string) => {
        try {
            const result = await window.api.saveLocalDat(id);
            if (result.success) {
                setAccountHasLocalDat((prev) => ({ ...prev, [id]: true }));
                showToast('Login saved for this account.');
            } else {
                showToast(result.message);
            }
        } catch {
            showToast('Failed to save login.');
        }
    };
```

- [ ] **Step 4: Pass new props to AccountCard**

Update the `<AccountCard>` rendering to include the new props:

```tsx
                        <AccountCard
                            key={account.id}
                            account={account}
                            onLaunch={handleLaunch}
                            onStop={handleStop}
                            onSaveLogin={handleSaveLogin}
                            isActiveProcess={activeAccountIds.includes(account.id)}
                            hasLocalDat={accountHasLocalDat[account.id] ?? false}
                            status={accountStatuses[account.id] ?? 'idle'}
                            statusCertainty={accountStatusCertainty[account.id]}
                            accountApiName={accountApiNames[account.id] || ''}
                            isBirthday={isBirthday(accountApiCreatedAt[account.id])}
                            onEdit={handleEditAccount}
                        />
```

- [ ] **Step 5: Verify full compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire up Local.dat save handler and status in App.tsx"
```

---

### Task 7: Clean up unused automation code

**Files:**
- Modify: `electron/main.ts` — remove dead code

- [ ] **Step 1: Remove the `@ts-ignore` + `startCredentialAutomation` function**

Delete the `// @ts-ignore - temporarily unused...` comment and the entire `startCredentialAutomation` function body (from the `@ts-ignore` line through the closing `}`). Also remove the `trackAutomationProcess` calls and `automationPidsByAccount` map if they are only used by the automation code.

Check first: grep for `automationPidsByAccount`, `trackAutomationProcess`, `stopAccountAutomation`, and `stopAllAutomation` to see if they're called from elsewhere (e.g., process cleanup on app exit). If `stopAllAutomation` is called in a cleanup handler, keep it but make it a no-op or remove the call too.

- [ ] **Step 2: Remove `-email`/`-password` from `stripManagedLaunchArguments`**

These are no longer managed args since we don't pass them. Remove from both `valueTakingFlags` and the `startsWith` checks:

Keep only:
```typescript
const valueTakingFlags = new Set(['--mumble', '-mumble', '-provider', '--provider']);
const standaloneFlags = new Set(['-autologin', '--autologin']);
```

And remove the `email`/`password` `startsWith` lines from the `=`-form check.

- [ ] **Step 3: Verify compilation**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "chore: remove unused UI automation code and credential arg stripping"
```

---

### Task 8: Manual end-to-end test

**Files:** None (testing only)

- [ ] **Step 1: Build and run the app**

Run: `npm run dev`

- [ ] **Step 2: Test launch without saved Local.dat**

1. Launch an account that has no saved Local.dat
2. Verify GW2 starts and shows the login screen (no `-autologin`)
3. Log in manually

- [ ] **Step 3: Test Save Login**

1. After logging in and GW2 is running or was recently closed, click "Save Login" on the account card
2. Verify toast shows "Login saved for this account."
3. Verify the Save button changes to the "saved" style (active ring color)

- [ ] **Step 4: Test launch with saved Local.dat**

1. Close GW2
2. Launch the same account again
3. Verify GW2 starts and skips the login screen (auto-login works)

- [ ] **Step 5: Test on second account**

Repeat steps 2-4 with a different account to verify per-account isolation works (swapping produces the correct Local.dat each time).

- [ ] **Step 6: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: address issues found during Local.dat e2e testing"
```
