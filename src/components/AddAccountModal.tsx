import React, { useState, useEffect } from 'react';
import { Account } from '../types';
import { X } from 'lucide-react';

interface AddAccountModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (account: Omit<Account, 'id'>) => void;
    onDelete: (id: string) => Promise<void>;
    onResaveLogin?: (id: string) => void;
    onClearLogin?: (id: string) => void;
    hasLocalDat?: boolean;
    initialData?: Account;
}

const AddAccountModal: React.FC<AddAccountModalProps> = ({ isOpen, onClose, onSave, onDelete, onResaveLogin, onClearLogin, hasLocalDat, initialData }) => {
    const [nickname, setNickname] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [launchArguments, setLaunchArguments] = useState('');
    const [apiKey, setApiKey] = useState('');


    const sanitizeLaunchArguments = (raw: string): string => {
        if (!raw) return '';
        const tokens = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
        const valueTakingFlags = new Set(['--mumble', '-mumble', '-email', '--email', '-password', '--password']);
        const standaloneFlags = new Set(['-autologin', '--autologin']);
        const cleaned: string[] = [];

        for (let i = 0; i < tokens.length; i += 1) {
            const token = tokens[i];
            const lower = token.toLowerCase();

            if (valueTakingFlags.has(lower)) {
                i += 1;
                continue;
            }
            if (
                lower.startsWith('--mumble=') ||
                lower.startsWith('-mumble=') ||
                lower.startsWith('--email=') ||
                lower.startsWith('-email=') ||
                lower.startsWith('--password=') ||
                lower.startsWith('-password=')
            ) {
                continue;
            }
            if (standaloneFlags.has(lower)) {
                continue;
            }

            cleaned.push(token);
        }

        return cleaned.join(' ').trim();
    };

    useEffect(() => {
        if (!isOpen) return;

        if (initialData) {
            setNickname(initialData.nickname);
            setEmail(initialData.email);
            setPassword(''); // Don't show existing password for security? Or show placeholder
            setLaunchArguments(sanitizeLaunchArguments(initialData.launchArguments || ''));
            setApiKey(initialData.apiKey || '');
            return;
        }

        // Opening from "+" should always start with an empty form.
        setNickname('');
        setEmail('');
        setPassword('');
        setLaunchArguments('');
        setApiKey('');
    }, [isOpen, initialData]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            nickname,
            email,
            passwordEncrypted: password, // Send raw, backend will encrypt. Variable name matches backend expectation.
            launchArguments: sanitizeLaunchArguments(launchArguments),
            apiKey: apiKey.trim(),

        });
        onClose();
    };



    const handleDelete = async () => {
        if (!initialData) return;
        if (!confirm(`Delete account "${initialData.nickname}"? This cannot be undone.`)) {
            return;
        }
        await onDelete(initialData.id);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed left-0 right-0 bottom-0 top-9 z-50 border-t border-[var(--theme-border)] bg-[var(--theme-surface)] flex flex-col">
                <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--theme-border)] bg-[var(--theme-surface)]">
                    <h2 className="text-xl font-bold text-white">{initialData ? 'Edit Account' : 'Add Account'}</h2>
                    <button onClick={onClose} className="text-[var(--theme-text-muted)] hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">Nickname</label>
                        <input
                            type="text"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors select-text"
                            placeholder="Main Account"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors select-text"
                            placeholder="example@arena.net"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors select-text"
                            placeholder={initialData ? 'Unchanged' : 'Password'}
                            required={!initialData}
                        />
                        {initialData && <p className="text-xs text-[var(--theme-text-dim)] mt-1">Leave empty to keep existing password.</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">Additional Launch Arguments</label>
                        <input
                            type="text"
                            value={launchArguments}
                            onChange={(e) => setLaunchArguments(e.target.value)}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors text-sm select-text"
                            placeholder="-shareArchive -windowed -mapLoadinfo"
                        />
                        <p className="text-xs text-[var(--theme-text-dim)] mt-1">
                            Internal args like autologin/mumble/credentials are managed by the app.{' '}
                            <button
                                type="button"
                                onClick={() => { void window.api.openExternal('https://wiki.guildwars2.com/wiki/Command_line_arguments'); }}
                                className="underline text-[var(--theme-text)] hover:text-white transition-colors"
                            >
                                View all GW2 command line arguments
                            </button>
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">GW2 API Key (Optional)</label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors text-sm select-text"
                            placeholder="Used to resolve account name"
                        />
                    </div>



                    {initialData && (
                        <div className="mt-6 pt-4 border-t border-[var(--theme-border)]">
                            <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-2">Saved Login</label>
                            <div className="flex items-center gap-3">
                                <span className="text-sm text-[var(--theme-text)]">
                                    {hasLocalDat ? 'Login data saved' : 'No saved login — log in manually with "Remember" checked, it will be saved automatically'}
                                </span>
                                <div className="flex gap-2 ml-auto shrink-0">
                                    {hasLocalDat && onResaveLogin && (
                                        <button
                                            type="button"
                                            onClick={() => onResaveLogin(initialData.id)}
                                            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--theme-control-bg)] hover:bg-[var(--theme-control-hover)] text-[var(--theme-text)] transition-colors"
                                        >
                                            Re-save
                                        </button>
                                    )}
                                    {hasLocalDat && onClearLogin && (
                                        <button
                                            type="button"
                                            onClick={() => onClearLogin(initialData.id)}
                                            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--theme-danger-soft)] text-[var(--theme-danger-text)] hover:bg-[color-mix(in_srgb,var(--theme-danger-soft)_75%,transparent)] transition-colors"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {initialData ? (
                        <div className="flex justify-between items-center mt-6 pt-4 border-t border-[var(--theme-border)]">
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="px-4 py-2 rounded-lg bg-[var(--theme-danger-soft)] text-[var(--theme-danger-text)] hover:text-[var(--theme-danger-text-hover)] hover:bg-[color-mix(in_srgb,var(--theme-danger-soft)_75%,transparent)] transition-colors"
                            >
                                Delete
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-strong)] text-white rounded-lg transition-colors font-medium"
                            >
                                Save
                            </button>
                        </div>
                    ) : (
                        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-[var(--theme-border)]">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg text-[var(--theme-text)] hover:bg-[var(--theme-control-bg)] transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-strong)] text-white rounded-lg transition-colors font-medium"
                            >
                                Save
                            </button>
                        </div>
                    )}
                </form>
        </div>
    );
};

export default AddAccountModal;
