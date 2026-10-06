// Access check: blocks the app when one of its identities is on the Axi
// denylist. See README "Access".
import {
  createAccessGate,
  createConfig,
  gw2KeyIdentities,
  type AccessGate,
  type AxiConfig,
  type Identity,
} from '@axiapps/axi-config';
import { blockIfTripped, handleBlocked, type ElectronLike, type RelaunchableApp } from '@axiapps/axi-config/electron';

export interface AccessDeps {
  electron: ElectronLike & { app: RelaunchableApp & { getPath(name: 'userData'): string } };
  config?: AxiConfig; // tests inject one; production creates it
  onBlocked?: (info: { persisted: boolean }) => void; // tests inject a spy
  readAccounts: () => Array<{ apiKey?: string; apiAccountName?: string }>;
  showcase: boolean;
  lookupKey?: (key: string) => Promise<Identity[]>;
}

export type AccessBoot = { blocked: true } | { blocked: false; gate: AccessGate; config: AxiConfig };

export async function startAccess(deps: AccessDeps): Promise<AccessBoot> {
  const config =
    deps.config ?? createConfig({ appId: 'axiam', cacheDir: deps.electron.app.getPath('userData') });
  await config.ready();
  if (blockIfTripped(deps.electron, config)) return { blocked: true };
  const gate = createAccessGate({
    config,
    onBlocked: deps.onBlocked ?? ((info) => handleBlocked(deps.electron, config, info)),
  });
  const lookupKey = deps.lookupKey ?? ((key: string) => gw2KeyIdentities(key));
  gate.addSource('vault', async () => {
    if (deps.showcase) return [];
    const identities: Identity[] = [];
    for (const account of deps.readAccounts()) {
      const name = account.apiAccountName?.trim();
      if (name) identities.push({ kind: 'gw2_account', value: name });
      const key = account.apiKey?.trim();
      if (key) identities.push(...(await lookupKey(key)));
    }
    return identities;
  });
  config.onChange(() => void gate.recheck());
  return { blocked: false, gate, config };
}
