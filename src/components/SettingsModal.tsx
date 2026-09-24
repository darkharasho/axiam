import React, { useState, useEffect, useRef } from 'react';
import { X, Github } from 'lucide-react';
import { ACCENTS, DEFAULT_ACCENT_ID, resolveAccentId } from '../themes/accents';
import { applyTheme } from '../themes/applyTheme';
import { showToast } from './Toast.tsx';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onThemeChange?: (id: string) => void;
}

type SettingsPayload = {
    gw2Path: string;
    masterPasswordPrompt: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never';
    themeId: string;
    allowMultiInstance: boolean;
};

const AUTOSAVE_DEBOUNCE_MS = 350;
const EXIT_MS = 300;

const hintStyle: React.CSSProperties = { font: 'var(--axi-t-small)', color: 'var(--axi-text-dim)', marginTop: 6 };
const sectionRuleStyle: React.CSSProperties = { borderTop: 'var(--axi-border-control) solid var(--axi-rule)', paddingTop: 16 };

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onThemeChange }) => {
    const [visible, setVisible] = useState(false);
    const [closing, setClosing] = useState(false);
    const [gw2Path, setGw2Path] = useState('');
    const [isLocatingGw2Path, setIsLocatingGw2Path] = useState(false);
    const [masterPasswordPrompt, setMasterPasswordPrompt] = useState<'every_time' | 'daily' | 'weekly' | 'monthly' | 'never'>('every_time');
    const [themeId, setThemeId] = useState(DEFAULT_ACCENT_ID);
    const [allowMultiInstance, setAllowMultiInstance] = useState<boolean>(false);
    const [showMultiInstanceConfirm, setShowMultiInstanceConfirm] = useState<boolean>(false);
    const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);
    const saveTimerRef = useRef<number | null>(null);
    const pendingSaveRef = useRef<{ payload: SettingsPayload; snapshot: string } | null>(null);
    const lastSavedSnapshotRef = useRef('');

    // Show/hide lifecycle
    useEffect(() => {
        if (isOpen) {
            setVisible(true);
            setClosing(false);
        }
    }, [isOpen]);

    const animateClose = () => {
        if (closing) return;
        flushPendingSave();
        setClosing(true);
        setTimeout(() => {
            setVisible(false);
            setClosing(false);
            onClose();
        }, EXIT_MS);
    };

    const buildPayload = (): SettingsPayload => ({
        gw2Path,
        masterPasswordPrompt,
        themeId,
        allowMultiInstance,
    });

    const commitSave = async (payload: SettingsPayload, snapshot: string): Promise<void> => {
        try {
            await window.api.saveSettings(payload);
            lastSavedSnapshotRef.current = snapshot;
        } catch {
            showToast('Failed to save settings.');
        }
    };

    const flushPendingSave = () => {
        const pending = pendingSaveRef.current;
        if (!pending) return;
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        pendingSaveRef.current = null;
        void commitSave(pending.payload, pending.snapshot);
    };

    useEffect(() => {
        if (!isOpen) {
            setIsHydrated(false);
            if (saveTimerRef.current !== null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            pendingSaveRef.current = null;
            return;
        }

        setIsHydrated(false);
        let cancelled = false;

        window.api.getSettings().then((settings) => {
            if (cancelled) return;
            const normalized: SettingsPayload = {
                gw2Path: settings?.gw2Path || '',
                masterPasswordPrompt: settings?.masterPasswordPrompt ?? 'every_time',
                // Legacy pre-redesign installs persisted a GW2-lore theme id
                // (e.g. `charr_warband`); route hydration through
                // resolveAccentId so state always holds a valid ACCENTS id.
                themeId: resolveAccentId(settings?.themeId),
                allowMultiInstance: settings?.allowMultiInstance ?? false,
            };
            setGw2Path(normalized.gw2Path);
            setMasterPasswordPrompt(normalized.masterPasswordPrompt);
            setThemeId(normalized.themeId);
            setAllowMultiInstance(normalized.allowMultiInstance);
            const snapshot = JSON.stringify(normalized);
            lastSavedSnapshotRef.current = snapshot;
            pendingSaveRef.current = null;
        }).finally(() => {
            if (!cancelled) setIsHydrated(true);
        });

        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !isHydrated) return;
        const payload = buildPayload();
        const snapshot = JSON.stringify(payload);
        if (snapshot === lastSavedSnapshotRef.current) return;
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
        }
        pendingSaveRef.current = { payload, snapshot };
        saveTimerRef.current = window.setTimeout(() => {
            const pending = pendingSaveRef.current;
            if (!pending) return;
            pendingSaveRef.current = null;
            saveTimerRef.current = null;
            void commitSave(pending.payload, pending.snapshot);
        }, AUTOSAVE_DEBOUNCE_MS);
    }, [
        isOpen,
        isHydrated,
        gw2Path,
        masterPasswordPrompt,
        themeId,
        allowMultiInstance,
    ]);

    const handleAutoLocateGw2Path = async () => {
        if (isLocatingGw2Path) return;
        setIsLocatingGw2Path(true);
        try {
            const result = await window.api.autoLocateGw2Path();
            if (result.found && result.path) {
                setGw2Path(result.path);
                showToast(`Found: ${result.path}`);
            } else {
                showToast(result.message);
            }
        } catch {
            showToast('Failed to auto-locate GW2 path.');
        } finally {
            setIsLocatingGw2Path(false);
        }
    };

    const handleExportDiagnostics = async () => {
        if (isExportingDiagnostics) return;
        setIsExportingDiagnostics(true);
        try {
            const result = await window.api.exportDiagnostics();
            if (!result.success) {
                showToast(result.message || 'Failed to export diagnostics.');
                return;
            }
            showToast(result.path ? `Diagnostics exported: ${result.path}` : 'Diagnostics exported.');
        } catch {
            showToast('Failed to export diagnostics.');
        } finally {
            setIsExportingDiagnostics(false);
        }
    };

    if (!visible) return null;

    const DiscordIcon = () => (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.249.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.077.077 0 0 0-.042-.106 13.11 13.11 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.1.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.062.062 0 0 0-.031-.03ZM8.02 15.331c-1.182 0-2.156-1.085-2.156-2.419 0-1.333.955-2.418 2.156-2.418 1.21 0 2.174 1.095 2.156 2.418 0 1.334-.955 2.419-2.156 2.419Zm7.975 0c-1.182 0-2.156-1.085-2.156-2.419 0-1.333.955-2.418 2.156-2.418 1.21 0 2.174 1.095 2.156 2.418 0 1.334-.946 2.419-2.156 2.419Z" />
        </svg>
    );

    return (
        <>
        <button
            className="axi-scrim"
            style={{ top: 38 }}
            onClick={animateClose}
            aria-label="Close Settings"
        />
        <div className="axi-drawer max-w-md" style={{ top: 38 }}>
            <div className="axi-drawer__head">
                <h2>Settings</h2>
                <button onClick={animateClose} className="axi-drawer__close" aria-label="Close Settings">
                    <X size={16} />
                </button>
            </div>

            <div className="axi-drawer__body flex flex-col gap-5">
                {/* GW2 Path */}
                <div>
                    <div className="axi-eyebrow">Guild Wars 2 Path</div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={gw2Path}
                            onChange={(e) => setGw2Path(e.target.value)}
                            className="axi-input select-text"
                            style={{ flex: 1 }}
                            placeholder="/path/to/Gw2-64.exe"
                        />
                        <button
                            type="button"
                            onClick={() => { void handleAutoLocateGw2Path(); }}
                            disabled={isLocatingGw2Path}
                            className="axi-btn"
                            style={{ whiteSpace: 'nowrap' }}
                            title="Attempt to auto-locate Guild Wars 2 executable"
                        >
                            {isLocatingGw2Path ? 'Locating...' : 'Auto Locate'}
                        </button>
                    </div>
                    <p style={hintStyle}>
                        Full path to the executable. If empty, launch defaults to Steam.
                    </p>
                </div>

                {/* Master Password Prompt */}
                <div>
                    <div className="axi-eyebrow">Master Password Prompt</div>
                    <select
                        value={masterPasswordPrompt}
                        onChange={(e) => setMasterPasswordPrompt(e.target.value as 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never')}
                        className="axi-select"
                    >
                        <option value="every_time">Every time</option>
                        <option value="daily">Once a day</option>
                        <option value="weekly">Once a week</option>
                        <option value="monthly">Once a month</option>
                        <option value="never">Never</option>
                    </select>
                </div>

                {/* Theme */}
                <div>
                    <div className="axi-eyebrow">Theme</div>
                    <div className="grid grid-cols-6 gap-2">
                        {ACCENTS.map((a) => (
                            <button
                                key={a.id}
                                type="button"
                                title={a.label}
                                aria-pressed={a.id === themeId}
                                onClick={() => { setThemeId(a.id); applyTheme(a.id); onThemeChange?.(a.id); }}
                                style={{
                                    height: 28,
                                    background: a.hex,
                                    border: 'var(--axi-border-hairline) solid var(--axi-ink-line)',
                                    outline: a.id === themeId ? 'var(--axi-border-control) solid var(--axi-text)' : 'none',
                                    outlineOffset: 2,
                                }}
                            />
                        ))}
                    </div>
                    <p style={hintStyle}>
                        {ACCENTS.find((a) => a.id === themeId)?.label}
                    </p>
                </div>

                {/* Diagnostics */}
                <div>
                    <div className="axi-eyebrow">Diagnostics</div>
                    <button
                        type="button"
                        onClick={() => { void handleExportDiagnostics(); }}
                        disabled={isExportingDiagnostics}
                        className="axi-btn w-full justify-center"
                    >
                        {isExportingDiagnostics ? 'Exporting...' : 'Export Diagnostics'}
                    </button>
                    <p style={hintStyle}>
                        Creates a support file with runtime info and recent logs.
                    </p>
                </div>

                {/* Community */}
                <div>
                    <div className="axi-eyebrow">Community</div>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={() => { void window.api.openExternal('https://discord.gg/UjzMXMGXEg'); }}
                            className="axi-btn axi-btn--ghost justify-center"
                            title="Open Discord"
                        >
                            <DiscordIcon />
                            Discord
                        </button>
                        <button
                            onClick={() => { void window.api.openExternal('https://github.com/darkharasho/axiam'); }}
                            className="axi-btn axi-btn--ghost justify-center"
                            title="Open GitHub"
                        >
                            <Github size={15} />
                            GitHub
                        </button>
                    </div>
                </div>

                {/* Experimental — Windows only. */}
                {window.api.platform === 'win32' && (
                    <div style={sectionRuleStyle}>
                        <div className="axi-eyebrow">Experimental</div>
                        <div className="flex items-start gap-3">
                            <button
                                role="switch"
                                aria-checked={allowMultiInstance}
                                className="axi-switch"
                                style={{ marginTop: 2 }}
                                onClick={() => {
                                    if (!allowMultiInstance) {
                                        setAllowMultiInstance(true);            // optimistic
                                        setShowMultiInstanceConfirm(true);
                                    } else {
                                        setAllowMultiInstance(false);
                                    }
                                }}
                            >
                                <span className="axi-switch__knob" />
                            </button>
                            <div>
                                <div style={{ font: 'var(--axi-t-label)', color: 'var(--axi-text)' }}>Allow multiple GW2 instances</div>
                                <div style={{ font: 'var(--axi-t-small)', color: 'var(--axi-text-dim)', marginTop: 4 }}>
                                    Lets AxiAM launch more than one Guild Wars 2 client at a time, each with its
                                    own credentials. Multi-boxing is tolerated by ArenaNet but not officially
                                    supported — use at your own risk. First launch of a new account will pre-fill
                                    another account's email; log in once with the correct account and it'll save
                                    per-account from then on.
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex justify-between items-center" style={sectionRuleStyle}>
                    <span style={{ font: 'var(--axi-t-small)', color: 'var(--axi-text-faint)' }}>Auto-saves</span>
                    <button
                        onClick={animateClose}
                        className="axi-btn axi-btn--ghost"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
        {showMultiInstanceConfirm && (
            <div
                className="axi-scrim"
                style={{ zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                role="dialog"
                aria-modal="true"
            >
                <div className="axi-panel" style={{ maxWidth: 380, width: '100%' }}>
                    <h4 style={{ font: 'var(--axi-t-h3)', letterSpacing: 'var(--axi-ls-h3)', margin: '0 0 10px' }}>
                        Enable multi-instance launches?
                    </h4>
                    <p style={{ font: 'var(--axi-t-small)', color: 'var(--axi-text-dim)', marginBottom: 12 }}>
                        AxiAM will launch additional Guild Wars 2 clients alongside the one
                        already running, each with its own per-account credentials.
                    </p>
                    <p style={{ font: 'var(--axi-t-small)', color: 'var(--axi-text-dim)', marginBottom: 16 }}>
                        Tolerated by ArenaNet but not officially endorsed. The first launch
                        of each new account pre-fills another account's email; log in once
                        with the correct account and it saves per-profile from then on.
                        Continue?
                    </p>
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            className="axi-btn"
                            onClick={() => {
                                setAllowMultiInstance(false);            // revert optimistic
                                setShowMultiInstanceConfirm(false);
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="axi-btn axi-btn--primary"
                            onClick={() => {
                                setAllowMultiInstance(true);
                                setShowMultiInstanceConfirm(false);
                            }}
                        >
                            Enable
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
};

export default SettingsModal;
