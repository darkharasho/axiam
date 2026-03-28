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
}
