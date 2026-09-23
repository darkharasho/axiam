import React, { useState, useEffect } from 'react';
import { Account } from '../types';
import { X } from 'lucide-react';

interface AddAccountModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (account: Omit<Account, 'id'>) => void;
    onDelete: (id: string) => Promise<void>;
    onClearLogin?: (id: string) => void;
    hasLocalDat?: boolean;
    initialData?: Account;
}

const EXIT_MS = 300;

const hintStyle: React.CSSProperties = { font: 'var(--axi-t-small)', color: 'var(--axi-text-dim)', marginTop: 6 };
const sectionRuleStyle: React.CSSProperties = { borderTop: 'var(--axi-border-control) solid var(--axi-rule)', paddingTop: 14 };

const AddAccountModal: React.FC<AddAccountModalProps> = ({ isOpen, onClose, onSave, onDelete, onClearLogin, hasLocalDat, initialData }) => {
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
        <div
            className="am-sheet fixed left-0 right-0 bottom-0 z-50 flex flex-col"
            style={{ top: 38 }}
        >
            {/* Header */}
            <div
                className="flex justify-between items-center"
                style={{ padding: '14px 20px', borderBottom: 'var(--axi-border-control) solid var(--axi-ink-line)' }}
            >
                <h2 style={{ font: 'var(--axi-t-h2)', letterSpacing: 'var(--axi-ls-h2)', margin: 0 }}>
                    {initialData ? 'Edit Account' : 'Add Account'}
                </h2>
                <button onClick={animateClose} className="axi-btn axi-btn--ghost" style={{ padding: 8 }} aria-label="Close">
                    <X size={16} />
                </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col gap-4" style={{ padding: '16px 20px' }}>
                <div>
                    <div className="axi-eyebrow">Nickname</div>
                    <input
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        className="axi-input select-text"
                        placeholder="Main Account"
                        required
                        autoFocus
                    />
                </div>

                <div>
                    <div className="axi-eyebrow">Email</div>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="axi-input select-text"
                        placeholder="example@arena.net"
                        required
                    />
                </div>

                <div>
                    <div className="axi-eyebrow">Password</div>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="axi-input select-text"
                        placeholder={initialData ? 'Unchanged' : 'Password'}
                        required={!initialData}
                    />
                    {initialData && <p style={hintStyle}>Leave empty to keep existing password.</p>}
                </div>

                <div>
                    <div className="axi-eyebrow">Additional Launch Arguments</div>
                    <input
                        type="text"
                        value={launchArguments}
                        onChange={(e) => setLaunchArguments(e.target.value)}
                        className="axi-input select-text"
                        placeholder="-shareArchive -windowed -mapLoadinfo"
                    />
                    <p style={hintStyle}>
                        Internal args like autologin/mumble/credentials are managed automatically.{' '}
                        <button
                            type="button"
                            onClick={() => { void window.api.openExternal('https://wiki.guildwars2.com/wiki/Command_line_arguments'); }}
                            className="axi-btn axi-btn--ghost"
                            style={{ padding: '2px 6px', display: 'inline-flex' }}
                        >
                            View all GW2 args
                        </button>
                    </p>
                </div>

                <div>
                    <div className="axi-eyebrow">GW2 API Key (Optional)</div>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="axi-input select-text"
                        placeholder="Used to resolve account name"
                    />
                </div>

                {/* Saved Login section */}
                {initialData && (
                    <div style={sectionRuleStyle}>
                        <div className="axi-eyebrow">Saved Login</div>
                        <div className="flex items-center gap-3">
                            <span style={{ font: 'var(--axi-t-small)', color: 'var(--axi-text-dim)', flex: 1 }}>
                                {hasLocalDat ? 'Login data saved' : 'No saved login — log in manually with "Remember" checked'}
                            </span>
                            <div className="flex gap-1.5 shrink-0">
                                {hasLocalDat && onClearLogin && (
                                    <button
                                        type="button"
                                        onClick={() => onClearLogin(initialData.id)}
                                        className="axi-btn"
                                        style={{ color: 'var(--axi-danger)' }}
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
                    <div className="flex justify-between items-center" style={sectionRuleStyle}>
                        <button
                            type="button"
                            onClick={handleDelete}
                            className="axi-btn"
                            style={{ color: 'var(--axi-danger)' }}
                        >
                            Delete
                        </button>
                        <button
                            type="submit"
                            className="axi-btn axi-btn--primary"
                        >
                            Save
                        </button>
                    </div>
                ) : (
                    <div className="flex justify-end gap-2" style={sectionRuleStyle}>
                        <button
                            type="button"
                            onClick={animateClose}
                            className="axi-btn axi-btn--ghost"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="axi-btn axi-btn--primary"
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
