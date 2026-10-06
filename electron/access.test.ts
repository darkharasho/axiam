import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createConfig, hashIdentity, type AxiConfig, type Identity } from '@axiapps/axi-config';
import { resetBlockScreenForTests } from '@axiapps/axi-config/electron';
import { startAccess, type AccessDeps } from './access.js';

const ACCOUNT_NAME = 'Fixture.1234';
const KEY_ACCOUNT = 'Keyed.5678';
const accounts = [{ apiKey: 'fixture-key', apiAccountName: ACCOUNT_NAME }];

let dir: string;
const configs: AxiConfig[] = [];

function manifestFetch(denylist: string[]): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify({ version: 1, flags: {}, minVersion: null, notice: null, denylist }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof globalThis.fetch;
}

async function makeConfig(fetchImpl: typeof globalThis.fetch): Promise<AxiConfig> {
  const config = createConfig({ appId: 'axiam', cacheDir: dir, fetch: fetchImpl, url: 'https://config.test' });
  configs.push(config);
  await config.ready();
  await config.refresh();
  return config;
}

function fakeElectron() {
  const windows: Array<{ loadURL: ReturnType<typeof vi.fn> }> = [];
  class FakeWindow {
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
    loadURL = vi.fn(async () => undefined);
    constructor() {
      windows.push(this as any);
    }
    isDestroyed() {
      return false;
    }
    destroy() {}
    removeMenu() {}
    on() {}
    static getAllWindows() {
      return [] as never[];
    }
  }
  const app = {
    quit: vi.fn(),
    on: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn(),
    getPath: () => dir,
  };
  const shell = { openExternal: vi.fn(async () => undefined) };
  return { electron: { app, BrowserWindow: FakeWindow, shell } as unknown as AccessDeps['electron'], windows, app };
}

const noKeyIdentities = async (): Promise<Identity[]> => [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiam-access-'));
  resetBlockScreenForTests();
});

afterEach(async () => {
  // Let any in-flight cache write settle before removing the directory.
  for (const c of configs.splice(0)) {
    await c.refresh();
    c.close();
  }
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

describe('access', () => {
  it('blocks at runtime when a vault identity is listed', async () => {
    const hash = await hashIdentity('gw2_account', ACCOUNT_NAME);
    const config = await makeConfig(manifestFetch([hash]));
    const onBlocked = vi.fn();
    const { electron } = fakeElectron();
    const boot = await startAccess({
      electron,
      config,
      onBlocked,
      readAccounts: () => accounts,
      showcase: false,
      lookupKey: noKeyIdentities,
    });
    if (boot.blocked) throw new Error('should not be blocked at boot');
    await boot.gate.recheck();
    await boot.gate.recheck();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith({ persisted: true });
  });

  it('blocks when the key lookup yields a listed identity', async () => {
    const hash = await hashIdentity('gw2_account', KEY_ACCOUNT);
    const config = await makeConfig(manifestFetch([hash]));
    const onBlocked = vi.fn();
    const lookupKey = vi.fn(async (): Promise<Identity[]> => [{ kind: 'gw2_account', value: KEY_ACCOUNT }]);
    const boot = await startAccess({
      electron: fakeElectron().electron,
      config,
      onBlocked,
      readAccounts: () => accounts,
      showcase: false,
      lookupKey,
    });
    if (boot.blocked) throw new Error('unexpected');
    await boot.gate.recheck();
    expect(lookupKey).toHaveBeenCalledWith('fixture-key');
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('does not block clean identities', async () => {
    const hash = await hashIdentity('gw2_account', 'Someone.9999');
    const config = await makeConfig(manifestFetch([hash]));
    const onBlocked = vi.fn();
    const boot = await startAccess({
      electron: fakeElectron().electron,
      config,
      onBlocked,
      readAccounts: () => accounts,
      showcase: false,
      lookupKey: noKeyIdentities,
    });
    if (boot.blocked) throw new Error('unexpected');
    await boot.gate.recheck();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('boots into the block screen when the sticky trip is set', async () => {
    const hash = await hashIdentity('gw2_account', ACCOUNT_NAME);
    const first = await makeConfig(manifestFetch([hash]));
    const result = await first.check([{ kind: 'gw2_account', value: ACCOUNT_NAME }]);
    expect(result).toEqual({ blocked: true, persisted: true });
    first.close();

    const second = await makeConfig(manifestFetch([hash]));
    const { electron, windows } = fakeElectron();
    const boot = await startAccess({
      electron,
      config: second,
      readAccounts: () => [],
      showcase: false,
      lookupKey: noKeyIdentities,
    });
    expect(boot).toEqual({ blocked: true });
    expect(windows).toHaveLength(1);
    expect(windows[0].loadURL).toHaveBeenCalled();
  });

  it('fails open when the manifest cannot be fetched and nothing is cached', async () => {
    const config = await makeConfig((async () => {
      throw new Error('offline');
    }) as unknown as typeof globalThis.fetch);
    const onBlocked = vi.fn();
    const boot = await startAccess({
      electron: fakeElectron().electron,
      config,
      onBlocked,
      readAccounts: () => accounts,
      showcase: false,
      lookupKey: noKeyIdentities,
    });
    if (boot.blocked) throw new Error('unexpected');
    await boot.gate.recheck();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('skips the check in showcase mode', async () => {
    const hash = await hashIdentity('gw2_account', ACCOUNT_NAME);
    const config = await makeConfig(manifestFetch([hash]));
    const onBlocked = vi.fn();
    const lookupKey = vi.fn(noKeyIdentities);
    const boot = await startAccess({
      electron: fakeElectron().electron,
      config,
      onBlocked,
      readAccounts: () => accounts,
      showcase: true,
      lookupKey,
    });
    if (boot.blocked) throw new Error('unexpected');
    await boot.gate.recheck();
    expect(onBlocked).not.toHaveBeenCalled();
    expect(lookupKey).not.toHaveBeenCalled();
  });
});
