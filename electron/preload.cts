import { contextBridge, ipcRenderer } from 'electron';
import { Account, AppSettings } from './types.js';

console.log('Preload script loaded!');

contextBridge.exposeInMainWorld('api', {
    hasMasterPassword: () => ipcRenderer.invoke('has-master-password'),
    shouldPromptMasterPassword: () => ipcRenderer.invoke('should-prompt-master-password'),
    setMasterPassword: (password: string) => ipcRenderer.invoke('set-master-password', password),
    verifyMasterPassword: (password: string) => ipcRenderer.invoke('verify-master-password', password),

    saveAccount: (account: Omit<Account, 'id'>) => ipcRenderer.invoke('save-account', account),
    updateAccount: (id: string, account: Omit<Account, 'id'>) => ipcRenderer.invoke('update-account', id, account),
    getAccounts: () => ipcRenderer.invoke('get-accounts'),
    deleteAccount: (id: string) => ipcRenderer.invoke('delete-account', id),
    launchAccount: (id: string) => ipcRenderer.invoke('launch-account', id),
    getActiveAccountProcesses: () => ipcRenderer.invoke('get-active-account-processes'),
    stopAccountProcess: (id: string) => ipcRenderer.invoke('stop-account-process', id),
    isGw2Running: () => ipcRenderer.invoke('is-gw2-running'),
    stopGw2Process: () => ipcRenderer.invoke('stop-gw2-process'),

    getLaunchStates: () => ipcRenderer.invoke('get-launch-states'),
    resolveAccountProfile: (apiKey: string) => ipcRenderer.invoke('resolve-account-profile', apiKey),
    setAccountApiProfile: (id: string, profile: { name?: string; created?: string }) => ipcRenderer.invoke('set-account-api-profile', id, profile),

    saveSettings: (settings: AppSettings) => ipcRenderer.invoke('save-settings', settings),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    autoLocateGw2Path: () => ipcRenderer.invoke('auto-locate-gw2-path'),
    getRuntimeFlags: () => ipcRenderer.invoke('get-runtime-flags'),
    checkForUpdates: () => ipcRenderer.send('check-for-updates'),
    restartApp: () => ipcRenderer.send('restart-app'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getWhatsNew: () => ipcRenderer.invoke('get-whats-new'),
    shouldShowWhatsNew: () => ipcRenderer.invoke('should-show-whats-new'),
    setLastSeenVersion: (version: string) => ipcRenderer.invoke('set-last-seen-version', version),
    openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
    exportDiagnostics: () => ipcRenderer.invoke('export-diagnostics'),
    onUpdateMessage: (callback: (value: string) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, value: string) => callback(value);
        ipcRenderer.on('update-message', listener);
        return () => ipcRenderer.removeListener('update-message', listener);
    },
    onUpdateAvailable: (callback: (value: unknown) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
        ipcRenderer.on('update-available', listener);
        return () => ipcRenderer.removeListener('update-available', listener);
    },
    onUpdateNotAvailable: (callback: (value: unknown) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
        ipcRenderer.on('update-not-available', listener);
        return () => ipcRenderer.removeListener('update-not-available', listener);
    },
    onUpdateError: (callback: (value: { message?: string } | string) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, value: { message?: string } | string) => callback(value);
        ipcRenderer.on('update-error', listener);
        return () => ipcRenderer.removeListener('update-error', listener);
    },
    onDownloadProgress: (callback: (value: unknown) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
        ipcRenderer.on('download-progress', listener);
        return () => ipcRenderer.removeListener('download-progress', listener);
    },
    onUpdateDownloaded: (callback: (value: unknown) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
        ipcRenderer.on('update-downloaded', listener);
        return () => ipcRenderer.removeListener('update-downloaded', listener);
    },

    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
    resetApp: () => ipcRenderer.send('reset-app'),
    configurePortalPermissions: () => ipcRenderer.invoke('configure-portal-permissions'),
    checkPortalPermissions: () => ipcRenderer.invoke('check-portal-permissions'),
    prewarmLinuxInputAuthorization: () => ipcRenderer.invoke('prewarm-linux-input-authorization'),
    getGw2UpdateStatus: () => ipcRenderer.invoke('get-gw2-update-status'),
    startGw2Update: (visible = false) => ipcRenderer.invoke('start-gw2-update', visible),
    saveLocalDat: (accountId: string) => ipcRenderer.invoke('save-local-dat', accountId),
    hasLocalDat: (accountId: string) => ipcRenderer.invoke('has-local-dat', accountId),
    deleteLocalDat: (accountId: string) => ipcRenderer.invoke('delete-local-dat', accountId),
    onGw2UpdateStatus: (callback: (value: unknown) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
        ipcRenderer.on('gw2-update-status', listener);
        return () => ipcRenderer.removeListener('gw2-update-status', listener);
    },
});
