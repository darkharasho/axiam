export interface Account {
    id: string;
    nickname: string;
    email: string;
    passwordEncrypted: string;
    launchArguments: string;
    apiKey?: string;
    apiAccountName?: string;
    apiCreatedAt?: string;
}

export interface AppSettings {
    gw2Path: string;
    masterPasswordPrompt: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never';
    themeId: string;
    linuxInputAuthorizationPrewarmAttempted?: boolean;
    gw2AutoUpdateBeforeLaunch?: boolean;
    gw2AutoUpdateBackground?: boolean;
    gw2AutoUpdateVisible?: boolean;
}

export interface Gw2UpdateStatus {
    phase: 'idle' | 'queued' | 'starting' | 'running' | 'completed' | 'failed';
    mode: 'before_launch' | 'background' | 'manual';
    platform: string;
    accountId?: string;
    startedAt?: number;
    completedAt?: number;
    message?: string;
}
