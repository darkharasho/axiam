import React, { useState, useEffect, useRef } from 'react';
import { X, Github } from 'lucide-react';
import { GW2_THEMES } from '../themes/themes';
import { applyTheme } from '../themes/applyTheme';
import { showToast } from './Toast.tsx';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type SettingsPayload = {
    gw2Path: string;
    masterPasswordPrompt: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never';
    themeId: string;
};

const AUTOSAVE_DEBOUNCE_MS = 350;
const EXIT_MS = 300;

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [visible, setVisible] = useState(false);
    const [closing, setClosing] = useState(false);
    const previewThemeRef = useRef<string | null>(null);
    const [gw2Path, setGw2Path] = useState('');
    const [isLocatingGw2Path, setIsLocatingGw2Path] = useState(false);
    const [masterPasswordPrompt, setMasterPasswordPrompt] = useState<'every_time' | 'daily' | 'weekly' | 'monthly' | 'never'>('every_time');
    const [themeId, setThemeId] = useState('blood_legion');
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
                themeId: settings?.themeId || 'blood_legion',
            };
            setGw2Path(normalized.gw2Path);
            setMasterPasswordPrompt(normalized.masterPasswordPrompt);
            setThemeId(normalized.themeId);
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
        <div className="fixed left-0 right-0 bottom-0 top-9 z-50">
            <button
                className={`absolute inset-0 ${closing ? 'modal-fade-out' : 'modal-fade-in'}`}
                style={{ background: 'var(--theme-overlay)', backdropFilter: 'blur(2px)' }}
                onClick={animateClose}
                aria-label="Close Settings"
            />
            <div
                className={`absolute right-0 top-0 h-full w-full max-w-md flex flex-col overflow-hidden ${closing ? 'modal-slide-out-right' : 'modal-slide-in'}`}
                style={{ background: 'var(--theme-surface)', borderLeft: '1px solid var(--theme-border)' }}
            >
                {/* Header */}
                <div className="flex justify-between items-center px-5 py-3.5 border-b border-[var(--theme-border)] shrink-0">
                    <h2 className="text-lg font-bold text-white">Settings</h2>
                    <button onClick={animateClose} className="titlebar-btn p-1.5">
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {/* GW2 Path */}
                    <div className="modal-content-reveal" style={{ animationDelay: '50ms' }}>
                        <label className="section-label mb-1.5 block">Guild Wars 2 Path</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={gw2Path}
                                onChange={(e) => setGw2Path(e.target.value)}
                                className="input-glass text-sm select-text flex-1"
                                placeholder="/path/to/Gw2-64.exe"
                            />
                            <button
                                type="button"
                                onClick={() => { void handleAutoLocateGw2Path(); }}
                                disabled={isLocatingGw2Path}
                                className="btn-surface px-3 py-2 text-xs whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Attempt to auto-locate Guild Wars 2 executable"
                            >
                                {isLocatingGw2Path ? 'Locating...' : 'Auto Locate'}
                            </button>
                        </div>
                        <p className="text-[10px] text-[var(--theme-text-dim)] mt-1.5 font-light leading-relaxed">
                            Full path to the executable. If empty, launch defaults to Steam.
                        </p>
                    </div>

                    {/* Master Password Prompt */}
                    <div className="modal-content-reveal" style={{ animationDelay: '100ms' }}>
                        <label className="section-label mb-1.5 block">Master Password Prompt</label>
                        <select
                            value={masterPasswordPrompt}
                            onChange={(e) => setMasterPasswordPrompt(e.target.value as 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never')}
                            className="input-glass input-glass-select text-sm select-text"
                        >
                            <option value="every_time">Every time</option>
                            <option value="daily">Once a day</option>
                            <option value="weekly">Once a week</option>
                            <option value="monthly">Once a month</option>
                            <option value="never">Never</option>
                        </select>
                    </div>

                    {/* Theme */}
                    <div className="modal-content-reveal" style={{ animationDelay: '150ms' }}>
                        <label className="section-label mb-2 block">Theme</label>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {GW2_THEMES.map((theme) => {
                                const bg = theme.vars['--theme-bg'] || '#111';
                                const accent = theme.vars['--theme-accent-strong'] || theme.vars['--theme-accent'] || '#666';
                                const isActive = theme.id === themeId;
                                return (
                                    <button
                                        key={theme.id}
                                        type="button"
                                        onClick={() => {
                                            previewThemeRef.current = null;
                                            setThemeId(theme.id);
                                            applyTheme(theme.id);
                                        }}
                                        onMouseEnter={() => {
                                            previewThemeRef.current = themeId;
                                            applyTheme(theme.id);
                                        }}
                                        onMouseLeave={() => {
                                            if (previewThemeRef.current !== null) {
                                                applyTheme(previewThemeRef.current);
                                                previewThemeRef.current = null;
                                            }
                                        }}
                                        className={`theme-swatch ${isActive ? 'theme-swatch--active' : ''}`}
                                        title={theme.name}
                                        style={{
                                            background: `linear-gradient(135deg, ${bg}, ${accent})`,
                                        }}
                                    />
                                );
                            })}
                        </div>
                        <p className="text-[11px] text-[var(--theme-text-muted)] font-medium">
                            {GW2_THEMES.find((theme) => theme.id === themeId)?.name}
                        </p>
                        <p className="text-[10px] text-[var(--theme-text-dim)] mt-0.5 font-light">
                            {GW2_THEMES.find((theme) => theme.id === themeId)?.description}
                        </p>
                    </div>

                    {/* Diagnostics */}
                    <div className="modal-content-reveal" style={{ animationDelay: '200ms' }}>
                        <label className="section-label mb-2 block">Diagnostics</label>
                        <button
                            type="button"
                            onClick={() => { void handleExportDiagnostics(); }}
                            disabled={isExportingDiagnostics}
                            className="btn-surface w-full px-3 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isExportingDiagnostics ? 'Exporting...' : 'Export Diagnostics'}
                        </button>
                        <p className="text-[10px] text-[var(--theme-text-dim)] mt-1.5 font-light">
                            Creates a support file with runtime info and recent logs.
                        </p>
                    </div>

                    {/* Community */}
                    <div className="modal-content-reveal" style={{ animationDelay: '250ms' }}>
                        <label className="section-label mb-2 block">Community</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => { void window.api.openExternal('https://discord.gg/UjzMXMGXEg'); }}
                                className="btn-surface px-3 py-2.5 text-sm inline-flex items-center justify-center gap-2"
                                title="Open Discord"
                            >
                                <DiscordIcon />
                                Discord
                            </button>
                            <button
                                onClick={() => { void window.api.openExternal('https://github.com/darkharasho/axiam'); }}
                                className="btn-surface px-3 py-2.5 text-sm inline-flex items-center justify-center gap-2"
                                title="Open GitHub"
                            >
                                <Github size={15} />
                                GitHub
                            </button>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex justify-between items-center pt-3 border-t border-[color-mix(in_srgb,var(--theme-border)_50%,transparent)] modal-content-reveal" style={{ animationDelay: '300ms' }}>
                        <span className="text-[10px] text-[var(--theme-text-dim)] font-light">Auto-saves</span>
                        <button
                            onClick={animateClose}
                            className="btn-ghost px-4 py-2 text-sm"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
