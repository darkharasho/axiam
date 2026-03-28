import Store from 'electron-store';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import log from 'electron-log';
import { Account, AppSettings } from './types.js';

// ─── User data migration: GW2 Account Manager → AxiAM ──────────────────────
// Must run before `new Store()` — electron-store derives its path from
// app.getPath('userData'), which changed when productName became "AxiAM".
{
  const appData = app.getPath('appData');
  const oldDir = path.join(appData, 'GW2 Account Manager');
  const newDir = path.join(appData, 'AxiAM');
  const newConfigExists = fs.existsSync(path.join(newDir, 'config.json'));
  if (fs.existsSync(oldDir) && !newConfigExists) {
    try {
      fs.cpSync(oldDir, newDir, { recursive: true });
      log.info('[Migration] Copied userData from "GW2 Account Manager" to AxiAM');
    } catch (err: any) {
      log.warn('[Migration] Failed to copy userData:', err?.message || err);
    }
  }
}

interface StoreSchema {
    accounts: Account[];
    settings: AppSettings;
    windowState: {
        x?: number;
        y?: number;
        width: number;
        height: number;
        isMaximized: boolean;
    };
    security_v2: {
        salt: string;
        validationHash: string;
        lastUnlockAt: number;
        cachedMasterKey: string;
    };
}

const store = new Store<StoreSchema>({
    defaults: {
        accounts: [],
        settings: {
            gw2Path: '',
            masterPasswordPrompt: 'every_time',
            themeId: 'blood_legion',
            gw2AutoUpdateBeforeLaunch: false,
            gw2AutoUpdateBackground: false,
            gw2AutoUpdateVisible: false,
        },
        windowState: {
            width: 400,
            height: 600,
            isMaximized: false,
        },
        security_v2: {
            salt: '',
            validationHash: '',
            lastUnlockAt: 0,
            cachedMasterKey: '',
        },
    },
});

export default store;
