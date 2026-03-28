/// <reference types="vite/client" />
import { Account, AppSettings } from './types';

declare global {
    const __APP_VERSION__: string;
}

interface Api {
    hasMasterPassword: () => Promise<boolean>;
    shouldPromptMasterPassword: () => Promise<boolean>;
    setMasterPassword: (password: string) => Promise<boolean>;
    verifyMasterPassword: (password: string) => Promise<boolean>;

    saveAccount: (account: Omit<Account, 'id'>) => Promise<boolean>;
    updateAccount: (id: string, account: Omit<Account, 'id'>) => Promise<boolean>;
    getAccounts: () => Promise<Account[]>;
    deleteAccount: (id: string) => Promise<boolean>;
    launchAccount: (id: string) => Promise<boolean>;
    getActiveAccountProcesses: () => Promise<Array<{ accountId: string; pid: number; mumbleName: string }>>;
    stopAccountProcess: (id: string) => Promise<boolean>;
    isGw2Running: () => Promise<boolean>;
    stopGw2Process: () => Promise<boolean>;
    capturePlayClickCalibration: (accountId: string) => Promise<{ xPercent: number; yPercent: number } | null>;
    resetPlayClickCalibration: (accountId: string) => Promise<boolean>;
    getLaunchStates: () => Promise<Array<{
        accountId: string;
        phase: 'idle' | 'launch_requested' | 'launcher_started' | 'credentials_waiting' | 'credentials_submitted' | 'process_detected' | 'running' | 'stopping' | 'stopped' | 'errored';
        certainty: 'verified' | 'inferred';
        updatedAt: number;
        note?: string;
    }>>;
    hasLocalDat: (id: string) => Promise<boolean>;
    saveLocalDat: (id: string) => Promise<{ success: boolean; message: string }>;
    deleteLocalDat: (id: string) => Promise<boolean>;
    resolveAccountProfile: (apiKey: string) => Promise<{ name: string; created: string }>;
    setAccountApiProfile: (id: string, profile: { name?: string; created?: string }) => Promise<boolean>;

    saveSettings: (settings: AppSettings) => Promise<void>;
    getSettings: () => Promise<AppSettings | null>;
    autoLocateGw2Path: () => Promise<{ found: boolean; path?: string; message: string }>;
    getRuntimeFlags: () => Promise<{ isDevShowcase: boolean }>;
    checkForUpdates: () => void;
    restartApp: () => void;
    getAppVersion: () => Promise<string>;
    getWhatsNew: () => Promise<{ version: string; releaseNotes: string }>;
    shouldShowWhatsNew: () => Promise<{ version: string; shouldShow: boolean }>;
    setLastSeenVersion: (version: string) => Promise<boolean>;
    openExternal: (url: string) => Promise<boolean>;
    exportDiagnostics: () => Promise<{ success: boolean; path?: string; message: string }>;
    onUpdateMessage: (callback: (value: string) => void) => () => void;
    onUpdateAvailable: (callback: (value: unknown) => void) => () => void;
    onUpdateNotAvailable: (callback: (value: unknown) => void) => () => void;
    onUpdateError: (callback: (value: { message?: string } | string) => void) => () => void;
    onDownloadProgress: (callback: (value: unknown) => void) => () => void;
    onUpdateDownloaded: (callback: (value: unknown) => void) => () => void;

    minimizeWindow: () => void;
    maximizeWindow: () => void;
    closeWindow: () => void;
    resetApp: () => void;
    configurePortalPermissions: () => Promise<{ success: boolean; message: string }>;
    checkPortalPermissions: () => Promise<{ configured: boolean; message: string }>;
    prewarmLinuxInputAuthorization: () => Promise<{ success: boolean; message: string }>;
    getGw2UpdateStatus: () => Promise<{
        phase: 'idle' | 'queued' | 'starting' | 'running' | 'completed' | 'failed';
        mode: 'before_launch' | 'background' | 'manual';
        platform: string;
        accountId?: string;
        startedAt?: number;
        completedAt?: number;
        message?: string;
    }>;
    startGw2Update: (visible?: boolean) => Promise<boolean>;
    onGw2UpdateStatus: (callback: (value: {
        phase: 'idle' | 'queued' | 'starting' | 'running' | 'completed' | 'failed';
        mode: 'before_launch' | 'background' | 'manual';
        platform: string;
        accountId?: string;
        startedAt?: number;
        completedAt?: number;
        message?: string;
    }) => void) => () => void;
}

declare global {
    interface Window {
        api: Api;
    }
}

export {};
