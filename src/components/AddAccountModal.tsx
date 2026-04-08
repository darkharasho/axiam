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

const EXIT_MS = 300;

const AddAccountModal: React.FC<AddAccountModalProps> = ({ isOpen, onClose, onSave, onDelete, onResaveLogin, onClearLogin, hasLocalDat, initialData }) => {
    const [nickname, setNickname] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [launchArguments, setLaunchArguments] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [visible, setVisible] = useState(false);
    const [closing, setClosing] = useState(false);

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

    // Show/hide lifecycle
    useEffect(() => {
        if (isOpen) {
            setVisible(true);
            setClosing(false);
        }
    }, [isOpen]);

    const animateClose = () => {
        if (closing) return;
        setClosing(true);
        setTimeout(() => {
            setVisible(false);
            setClosing(false);
            onClose();
        }, EXIT_MS);
    };

    useEffect(() => {
        if (!isOpen) return;

        if (initialData) {
            setNickname(initialData.nickname);
            setEmail(initialData.email);
            setPassword('');
            setLaunchArguments(sanitizeLaunchArguments(initialData.launchArguments || ''));
            setApiKey(initialData.apiKey || '');
            return;
        }

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
            passwordEncrypted: password,
            launchArguments: sanitizeLaunchArguments(launchArguments),
            apiKey: apiKey.trim(),
        });
        animateClose();
    };

    const handleDelete = async () => {
        if (!initialData) return;
        if (!confirm(`Delete account "${initialData.nickname}"? This cannot be undone.`)) {
            return;
        }
        await onDelete(initialData.id);
        animateClose();
    };

    if (!visible) return null;

    return (
        <div className={`fixed left-0 right-0 bottom-0 top-9 z-50 flex flex-col ${closing ? 'modal-slide-out' : 'modal-slide-up'}`}
             style={{ background: 'var(--theme-surface)' }}>
            {/* Header */}
            <div className="flex justify-between items-center px-5 py-3.5 border-b border-[var(--theme-border)]">
                <h2 className="text-lg font-bold text-white">{initialData ? 'Edit Account' : 'Add Account'}</h2>
                <button onClick={animateClose} className="titlebar-btn p-1.5">
                    <X size={18} />
                </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <div className="modal-content-reveal" style={{ animationDelay: '50ms' }}>
                    <label className="section-label mb-1.5 block">Nickname</label>
                    <input
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        className="input-glass select-text"
                        placeholder="Main Account"
                        required
                        autoFocus
                    />
                </div>

                <div className="modal-content-reveal" style={{ animationDelay: '100ms' }}>
                    <label className="section-label mb-1.5 block">Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="input-glass select-text"
                        placeholder="example@arena.net"
                        required
                    />
                </div>

                <div className="modal-content-reveal" style={{ animationDelay: '150ms' }}>
                    <label className="section-label mb-1.5 block">Password</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="input-glass select-text"
                        placeholder={initialData ? 'Unchanged' : 'Password'}
                        required={!initialData}
                    />
                    {initialData && <p className="text-[10px] text-[var(--theme-text-dim)] mt-1.5 font-light">Leave empty to keep existing password.</p>}
                </div>

                <div className="modal-content-reveal" style={{ animationDelay: '200ms' }}>
                    <label className="section-label mb-1.5 block">Additional Launch Arguments</label>
                    <input
                        type="text"
                        value={launchArguments}
                        onChange={(e) => setLaunchArguments(e.target.value)}
                        className="input-glass text-sm select-text"
                        placeholder="-shareArchive -windowed -mapLoadinfo"
                    />
                    <p className="text-[10px] text-[var(--theme-text-dim)] mt-1.5 font-light">
                        Internal args like autologin/mumble/credentials are managed automatically.{' '}
                        <button
                            type="button"
                            onClick={() => { void window.api.openExternal('https://wiki.guildwars2.com/wiki/Command_line_arguments'); }}
                            className="underline text-[var(--theme-text-muted)] hover:text-white transition-colors"
                        >
                            View all GW2 args
                        </button>
                    </p>
                </div>

                <div className="modal-content-reveal" style={{ animationDelay: '250ms' }}>
                    <label className="section-label mb-1.5 block">GW2 API Key (Optional)</label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="input-glass text-sm select-text"
                        placeholder="Used to resolve account name"
                    />
                </div>

                {/* Saved Login section */}
                {initialData && (
                    <div className="modal-content-reveal pt-3 mt-3 border-t border-[color-mix(in_srgb,var(--theme-border)_50%,transparent)]" style={{ animationDelay: '300ms' }}>
                        <label className="section-label mb-2 block">Saved Login</label>
                        <div className="flex items-center gap-3">
                            <span className="text-[12px] text-[var(--theme-text-muted)] font-light flex-1">
                                {hasLocalDat ? 'Login data saved' : 'No saved login \u2014 log in manually with "Remember" checked'}
                            </span>
                            <div className="flex gap-1.5 shrink-0">
                                {hasLocalDat && onResaveLogin && (
                                    <button
                                        type="button"
                                        onClick={() => onResaveLogin(initialData.id)}
                                        className="btn-surface px-3 py-1.5 text-xs"
                                    >
                                        Re-save
                                    </button>
                                )}
                                {hasLocalDat && onClearLogin && (
                                    <button
                                        type="button"
                                        onClick={() => onClearLogin(initialData.id)}
                                        className="btn-danger px-3 py-1.5 text-xs"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Actions */}
                {initialData ? (
                    <div className="flex justify-between items-center pt-3 mt-3 border-t border-[color-mix(in_srgb,var(--theme-border)_50%,transparent)] modal-content-reveal" style={{ animationDelay: '350ms' }}>
                        <button
                            type="button"
                            onClick={handleDelete}
                            className="btn-danger px-4 py-2 text-sm"
                        >
                            Delete
                        </button>
                        <button
                            type="submit"
                            className="btn-primary px-5 py-2 text-sm font-semibold"
                        >
                            Save
                        </button>
                    </div>
                ) : (
                    <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-[color-mix(in_srgb,var(--theme-border)_50%,transparent)] modal-content-reveal" style={{ animationDelay: '300ms' }}>
                        <button
                            type="button"
                            onClick={animateClose}
                            className="btn-ghost px-4 py-2 text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-primary px-5 py-2 text-sm font-semibold"
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
