import { useEffect, useRef, useState } from 'react';
import { Account } from './types.js';
import AccountCard from './components/AccountCard.tsx';
import AddAccountModal from './components/AddAccountModal.tsx';
import MasterPasswordModal from './components/MasterPasswordModal.tsx';
import SettingsModal from './components/SettingsModal.tsx';
import WhatsNewScreen from './components/WhatsNewScreen.tsx';
import { applyTheme } from './themes/applyTheme';
import { showToast, ToastContainer } from './components/Toast.tsx';
import { withTimeout } from './ipcTimeout';
import { Plus, Settings, Minus, Square, X, Sparkles, Search, Palette } from 'lucide-react';
import SkeletonCards from './components/SkeletonCards.tsx';
import { ACCENTS, DEFAULT_ACCENT_ID } from './themes/accents';
import { ContextMenuContainer } from './components/ContextMenu.tsx';
import Tooltip from './components/Tooltip.tsx';

type LaunchPhase = 'idle' | 'launch_requested' | 'patching' | 'launcher_started' | 'credentials_waiting' | 'credentials_submitted' | 'process_detected' | 'running' | 'stopping' | 'stopped' | 'errored';
type LaunchCertainty = 'verified' | 'inferred';
type LaunchStateInfo = { accountId: string; phase: LaunchPhase; certainty: LaunchCertainty; updatedAt: number; note?: string };

type UpdateChipState = {
    phase: 'checking' | 'downloading' | 'ready' | 'error' | 'up_to_date' | 'dismissing';
    label: string;
    progress: number | null;
};

function UpdateBadge({ state }: { state: UpdateChipState }) {
    const { phase, label, progress } = state;
    const shortLabel = phase === 'checking'
        ? 'CHECKING'
        : phase === 'downloading'
            ? (progress !== null ? `UPDATE ${Math.round(progress)}%` : 'UPDATE')
            : phase === 'ready'
                ? 'RESTART'
                : phase === 'up_to_date' || phase === 'dismissing'
                    ? 'UP TO DATE'
                    : 'UPDATE ERROR';
    const isError = phase === 'error';
    return (
        <span
            className={`axi-chip ${isError ? 'axi-chip--danger' : 'axi-chip--meta'} no-drag`}
            title={label}
            onClick={phase === 'ready' ? () => window.api?.restartApp() : undefined}
        >
            {phase === 'downloading' && <span className="am-status-dot am-status-dot--idle am-work" aria-hidden="true" />}
            {shortLabel}
        </span>
    );
}

type TitleBarProps = {
    minimal?: boolean;
    version: string;
    isDev: boolean;
    updateState: UpdateChipState | null;
    onWhatsNew: () => void;
    onMinimize: () => void;
    onMaximize: () => void;
    onClose: () => void;
};

function TitleBar({ minimal, version, isDev, updateState, onWhatsNew, onMinimize, onMaximize, onClose }: TitleBarProps) {
    return (
        <header className="axi-titlebar draggable">
            <span className="axi-diamond" aria-hidden="true" />
            <span>AXIAM</span>
            <span style={{ color: 'var(--axi-text-faint)' }}>v{version}</span>
            {isDev && <span className="axi-chip">DEV</span>}
            {updateState && <UpdateBadge state={updateState} />}
            <div className="axi-titlebar__btns no-drag">
                <button onClick={onWhatsNew} aria-label="What's New"><Sparkles size={13} /></button>
                {!minimal && <button onClick={onMinimize} aria-label="Minimize"><Minus size={13} /></button>}
                {!minimal && <button onClick={onMaximize} aria-label="Maximize"><Square size={11} /></button>}
                <button onClick={onClose} aria-label="Close"><X size={13} /></button>
            </div>
        </header>
    );
}

function App() {
    const ACTIVE_PROCESS_MISS_THRESHOLD = 3;
    const appVersion = __APP_VERSION__;
    const isDev = import.meta.env.DEV;
    const [isShowcaseMode, setIsShowcaseMode] = useState(false);
    const showDevChrome = isDev && !isShowcaseMode;
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [activeAccountIds, setActiveAccountIds] = useState<string[]>([]);
    const [accountApiNames, setAccountApiNames] = useState<Record<string, string>>({});
    const [accountApiCreatedAt, setAccountApiCreatedAt] = useState<Record<string, string>>({});
    const [accountStatuses, setAccountStatuses] = useState<Record<string, 'idle' | 'launching' | 'running' | 'stopping' | 'errored'>>({});
    const [accountHasLocalDat, setAccountHasLocalDat] = useState<Record<string, boolean>>({});
    const [accountStatusCertainty, setAccountStatusCertainty] = useState<Record<string, LaunchCertainty>>({});
    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [isUnlocked, setIsUnlocked] = useState(false);
    const [masterPasswordMode, setMasterPasswordMode] = useState<'set' | 'verify'>('verify');
    const [masterPasswordError, setMasterPasswordError] = useState('');

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<Account | undefined>(undefined);

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [updatePhase, setUpdatePhase] = useState<'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'up_to_date' | 'dismissing'>('idle');
    const [updateLabel, setUpdateLabel] = useState('');
    const [updateProgress, setUpdateProgress] = useState<number | null>(null);
    const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);
    const [whatsNewVersion, setWhatsNewVersion] = useState(appVersion);
    const [whatsNewNotes, setWhatsNewNotes] = useState<string>('Loading release notes...');
    const processMissCountsRef = useRef<Record<string, number>>({});
    const updateDismissTimerRef = useRef<number | null>(null);
    const updateHideTimerRef = useRef<number | null>(null);
    const autoWhatsNewCheckedRef = useRef(false);
    const [accountsLoading, setAccountsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [accountOrder, setAccountOrder] = useState<string[]>([]);
    const [dragOverIndex, setDragOverIndex] = useState(-1);
    const dragSourceIndex = useRef(-1);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [currentThemeId, setCurrentThemeId] = useState(DEFAULT_ACCENT_ID);
    const [, setMaximized] = useState(false);

    useEffect(() => {
        return window.api?.onMaximizedChange?.((m: boolean) => setMaximized(m));
    }, []);

    useEffect(() => {
        if (!window.api) {
            alert("FATAL: window.api is missing! IPC broken.");
            return;
        }
        window.api.getRuntimeFlags().then((flags) => {
            setIsShowcaseMode(Boolean(flags?.isDevShowcase));
        }).catch(() => {
            setIsShowcaseMode(false);
        });
        window.api.getSettings().then((settings) => {
            // Legacy pre-redesign installs persisted a GW2-lore theme id
            // (e.g. `charr_warband`); applyTheme resolves it and returns the
            // resolved ACCENTS id, so state never holds a stale raw id.
            const resolved = applyTheme(settings?.themeId);
            setCurrentThemeId(resolved);
        });
        checkMasterPassword().finally(() => setIsAuthChecking(false));
    }, []);

    const checkMasterPassword = async () => {
        try {
            const hasPassword = await withTimeout(window.api.hasMasterPassword(), 10_000, 'hasMasterPassword');
            if (hasPassword) {
                const shouldPrompt = await withTimeout(window.api.shouldPromptMasterPassword(), 10_000, 'shouldPromptMasterPassword');
                if (shouldPrompt) {
                    setMasterPasswordMode('verify');
                } else {
                    setIsUnlocked(true);
                    await loadAccounts();
                }
            } else {
                setMasterPasswordMode('set');
            }
        } catch {
            showToast('Failed to check authentication status.');
        }
    };

    const handleMasterPasswordSubmit = async (password: string) => {
        setMasterPasswordError('');
        try {
            if (masterPasswordMode === 'set') {
                await withTimeout(window.api.setMasterPassword(password), 10_000, 'setMasterPassword');
                setIsUnlocked(true);
                loadAccounts();
            } else {
                const isValid = await withTimeout(window.api.verifyMasterPassword(password), 10_000, 'verifyMasterPassword');
                if (isValid) {
                    setIsUnlocked(true);
                    loadAccounts();
                } else {
                    setMasterPasswordError('Invalid password');
                }
            }
        } catch {
            showToast('Failed to verify master password.');
        }
    };

    const loadAccounts = async () => {
        try {
            const loadedAccounts = await withTimeout(window.api.getAccounts(), 10_000, 'getAccounts');
            setAccounts(loadedAccounts);
            // Restore or initialize order
            setAccountOrder((prev) => {
                const existingIds = new Set(loadedAccounts.map((a) => a.id));
                const saved = prev.length > 0 ? prev : loadSavedOrder();
                const ordered = saved.filter((id) => existingIds.has(id));
                const newIds = loadedAccounts.map((a) => a.id).filter((id) => !ordered.includes(id));
                return [...ordered, ...newIds];
            });
            const localDatStatus: Record<string, boolean> = {};
            for (const acc of loadedAccounts) {
                localDatStatus[acc.id] = await window.api.hasLocalDat(acc.id);
            }
            setAccountHasLocalDat(localDatStatus);
        } catch {
            showToast('Failed to load accounts.');
        } finally {
            setAccountsLoading(false);
        }
    };

    const refreshActiveProcesses = async () => {
        let active: { accountId: string }[];
        let launchStates: LaunchStateInfo[];
        try {
            [active, launchStates] = await Promise.all([
                withTimeout(window.api.getActiveAccountProcesses(), 10_000, 'getActiveAccountProcesses'),
                withTimeout(window.api.getLaunchStates(), 10_000, 'getLaunchStates') as Promise<LaunchStateInfo[]>,
            ]);
        } catch {
            return;
        }
        const rawActiveIds = active.map((processInfo) => processInfo.accountId);
        const rawActiveSet = new Set(rawActiveIds);
        const launchStateMap = new Map(launchStates.map((state) => [state.accountId, state] as const));

        setActiveAccountIds((previous) => {
            const previousSet = new Set(previous);
            const nextSet = new Set(rawActiveIds);
            const allTrackedIds = new Set([...previousSet, ...rawActiveSet]);

            allTrackedIds.forEach((id) => {
                if (rawActiveSet.has(id)) {
                    processMissCountsRef.current[id] = 0;
                    nextSet.add(id);
                    return;
                }
                const nextMisses = (processMissCountsRef.current[id] || 0) + 1;
                processMissCountsRef.current[id] = nextMisses;
                if (previousSet.has(id) && nextMisses < ACTIVE_PROCESS_MISS_THRESHOLD) {
                    nextSet.add(id);
                }
            });

            const stabilizedActiveIds = Array.from(nextSet);
            const stabilizedSet = new Set(stabilizedActiveIds);
            setAccountStatuses((previousStatuses) => {
                const nextStatuses = { ...previousStatuses };
                Object.keys(nextStatuses).forEach((id) => {
                    if (stabilizedSet.has(id)) {
                        nextStatuses[id] = 'running';
                    } else if (nextStatuses[id] === 'running' || nextStatuses[id] === 'stopping') {
                        nextStatuses[id] = 'idle';
                    }
                });
                launchStateMap.forEach((launchState, id) => {
                    const mapped = mapLaunchPhaseToStatus(launchState.phase);
                    if (!mapped) return;
                    if (!stabilizedSet.has(id) && (launchState.phase === 'running' || launchState.phase === 'process_detected' || launchState.phase === 'stopping')) {
                        nextStatuses[id] = 'idle';
                        return;
                    }
                    nextStatuses[id] = mapped;
                });
                return nextStatuses;
            });
            setAccountStatusCertainty(() => {
                const next: Record<string, LaunchCertainty> = {};
                launchStateMap.forEach((launchState, id) => {
                    next[id] = launchState.certainty;
                });
                return next;
            });

            return stabilizedActiveIds;
        });
    };

    const handleSaveAccount = async (accountData: Omit<Account, 'id'>) => {
        try {
            if (editingAccount) {
                await withTimeout(window.api.updateAccount(editingAccount.id, accountData), 10_000, 'updateAccount');
            } else {
                await withTimeout(window.api.saveAccount(accountData), 10_000, 'saveAccount');
            }
            loadAccounts();
            setEditingAccount(undefined);
        } catch {
            showToast('Failed to save account.');
        }
    };

    const handleDeleteAccount = async (id: string) => {
        try {
            await withTimeout(window.api.deleteAccount(id), 10_000, 'deleteAccount');
            loadAccounts();
            setAccountStatuses((previous) => {
                const next = { ...previous };
                delete next[id];
                return next;
            });
        } catch {
            showToast('Failed to delete account.');
        }
    };

    const handleEditAccount = (account: Account) => {
        setEditingAccount(account);
        setIsAddModalOpen(true);
    };

    const handleLaunch = async (id: string) => {
        processMissCountsRef.current[id] = 0;
        setAccountStatuses((previous) => ({ ...previous, [id]: 'launching' }));
        try {
            const launched = await withTimeout(window.api.launchAccount(id), 60_000, 'launchAccount');
            if (!launched) {
                setAccountStatuses((previous) => ({ ...previous, [id]: 'errored' }));
                let reason: string | null = null;
                try {
                    reason = await window.api.getLaunchError(id);
                } catch { /* ignore */ }
                showToast(reason || 'GW2 did not report as launched. Check Steam and launcher state.');
            } else {
                setAccountStatuses((previous) => ({ ...previous, [id]: 'running' }));
            }
        } catch {
            setAccountStatuses((previous) => ({ ...previous, [id]: 'errored' }));
            showToast('Failed to launch GW2 for this account.');
        }
        setTimeout(() => {
            refreshActiveProcesses();
        }, 600);
    };

    const handleStop = async (id: string) => {
        processMissCountsRef.current[id] = 0;
        setAccountStatuses((previous) => ({ ...previous, [id]: 'stopping' }));
        try {
            const stopped = await withTimeout(window.api.stopAccountProcess(id), 15_000, 'stopAccountProcess');
            if (!stopped) {
                setAccountStatuses((previous) => ({ ...previous, [id]: 'errored' }));
            }
        } catch {
            setAccountStatuses((previous) => ({ ...previous, [id]: 'errored' }));
            showToast('Failed to stop account process.');
        }
        setTimeout(() => {
            refreshActiveProcesses();
        }, 300);
    };

    const handleClearLogin = async (id: string) => {
        try {
            await window.api.deleteLocalDat(id);
            setAccountHasLocalDat((prev) => ({ ...prev, [id]: false }));
            showToast('Saved login cleared.');
        } catch {
            showToast('Failed to clear saved login.');
        }
    };

    useEffect(() => {
        setAccountStatuses((previous) => {
            const next: Record<string, 'idle' | 'launching' | 'running' | 'stopping' | 'errored'> = {};
            accounts.forEach((account) => {
                next[account.id] = previous[account.id] ?? 'idle';
            });
            return next;
        });
        const validIds = new Set(accounts.map((account) => account.id));
        Object.keys(processMissCountsRef.current).forEach((id) => {
            if (!validIds.has(id)) {
                delete processMissCountsRef.current[id];
            }
        });
    }, [accounts]);

    useEffect(() => {
        let cancelled = false;
        const cached: Record<string, string> = {};
        const cachedCreatedAt: Record<string, string> = {};
        accounts.forEach((account) => {
            const cachedName = (account.apiAccountName || '').trim();
            if (cachedName) {
                cached[account.id] = cachedName;
            }
            const createdAt = (account.apiCreatedAt || '').trim();
            if (createdAt) {
                cachedCreatedAt[account.id] = createdAt;
            }
        });
        setAccountApiNames(cached);
        setAccountApiCreatedAt(cachedCreatedAt);

        const accountsWithApiKey = accounts.filter((account) => {
            const key = (account.apiKey || '').trim();
            const cachedName = (account.apiAccountName || '').trim();
            const createdAt = (account.apiCreatedAt || '').trim();
            return key.length > 0 && (cachedName.length === 0 || createdAt.length === 0);
        });

        if (accountsWithApiKey.length === 0) {
            return () => {
                cancelled = true;
            };
        }

        const loadApiNames = async () => {
            const resolvedEntries = await Promise.all(accountsWithApiKey.map(async (account) => {
                try {
                    const token = (account.apiKey || '').trim();
                    const profile = await withTimeout(window.api.resolveAccountProfile(token), 15_000, 'resolveAccountProfile');
                    return [account.id, profile.name, profile.created] as const;
                } catch {
                    return [account.id, '', ''] as const;
                }
            }));

            if (cancelled) return;

            resolvedEntries.forEach(([id, name, created]) => {
                if (name || created) {
                    void window.api.setAccountApiProfile(id, { name, created });
                }
            });
            setAccountApiNames((previous) => {
                const next = { ...previous };
                resolvedEntries.forEach(([id, name]) => {
                    if (name) next[id] = name;
                });
                return next;
            });
            setAccountApiCreatedAt((previous) => {
                const next = { ...previous };
                resolvedEntries.forEach(([id, _name, created]) => {
                    if (created) next[id] = created;
                });
                return next;
            });
        };

        loadApiNames();

        return () => {
            cancelled = true;
        };
    }, [accounts]);

    useEffect(() => {
        if (!isUnlocked) return;
        refreshActiveProcesses();
        const timer = window.setInterval(() => {
            refreshActiveProcesses();
        }, 3000);
        return () => {
            window.clearInterval(timer);
        };
    }, [isUnlocked]);

    useEffect(() => {
        if (!window.api) return;

        const clearUpdateTimers = () => {
            if (updateDismissTimerRef.current !== null) {
                window.clearTimeout(updateDismissTimerRef.current);
                updateDismissTimerRef.current = null;
            }
            if (updateHideTimerRef.current !== null) {
                window.clearTimeout(updateHideTimerRef.current);
                updateHideTimerRef.current = null;
            }
        };

        const removeListeners: Array<() => void> = [
            window.api.onUpdateMessage((value) => {
                clearUpdateTimers();
                const message = String(value || '').trim() || 'Checking for updates...';
                setUpdatePhase('checking');
                setUpdateLabel(message);
                setUpdateProgress(null);
            }),
            window.api.onUpdateAvailable(() => {
                clearUpdateTimers();
                setUpdatePhase('downloading');
                setUpdateLabel('Downloading update...');
            }),
            window.api.onDownloadProgress((value) => {
                clearUpdateTimers();
                const percentRaw = Number((value as { percent?: number } | null)?.percent);
                const percent = Number.isFinite(percentRaw) ? Math.max(0, Math.min(100, percentRaw)) : null;
                setUpdatePhase('downloading');
                setUpdateProgress(percent);
                setUpdateLabel(percent === null ? 'Downloading update...' : `Downloading update... ${Math.round(percent)}%`);
            }),
            window.api.onUpdateDownloaded(() => {
                clearUpdateTimers();
                setUpdatePhase('ready');
                setUpdateLabel('Restart to update');
                setUpdateProgress(100);
            }),
            window.api.onUpdateNotAvailable(() => {
                clearUpdateTimers();
                setUpdatePhase('up_to_date');
                setUpdateLabel('Up to date');
                setUpdateProgress(null);
                updateDismissTimerRef.current = window.setTimeout(() => {
                    setUpdatePhase('dismissing');
                    updateHideTimerRef.current = window.setTimeout(() => {
                        setUpdatePhase('idle');
                        setUpdateLabel('');
                        setUpdateProgress(null);
                    }, 320);
                }, 850);
            }),
            window.api.onUpdateError((value) => {
                clearUpdateTimers();
                const message = typeof value === 'string'
                    ? value
                    : String(value?.message || 'Update check failed');
                setUpdatePhase('error');
                setUpdateLabel(message);
                setUpdateProgress(null);
            }),
        ];

        return () => {
            clearUpdateTimers();
            removeListeners.forEach((remove) => remove());
        };
    }, []);

    const showUpdateIndicator = updatePhase !== 'idle';
    const updateIndicatorText = updateLabel
        || (updatePhase === 'checking'
            ? 'Checking for updates...'
            : updatePhase === 'downloading'
                ? 'Downloading update...'
                : updatePhase === 'ready'
                    ? 'Restart to apply update'
                    : updatePhase === 'up_to_date' || updatePhase === 'dismissing'
                        ? 'Up to date'
                        : 'Update error');

    const updateState: UpdateChipState | null = showUpdateIndicator
        ? { phase: updatePhase as UpdateChipState['phase'], label: updateIndicatorText, progress: updateProgress }
        : null;

    // Window controls
    const minimize = () => {
        if (window.api) window.api.minimizeWindow();
    };
    const maximize = () => {
        if (window.api) window.api.maximizeWindow();
    };
    const close = () => {
        if (window.api) window.api.closeWindow();
    };
    const openWhatsNew = async (options?: { markSeen?: boolean }) => {
        setIsWhatsNewOpen(true);
        setWhatsNewNotes('Loading release notes...');
        try {
            const payload = await window.api.getWhatsNew();
            const resolvedVersion = payload?.version || appVersion;
            setWhatsNewVersion(resolvedVersion);
            setWhatsNewNotes(payload?.releaseNotes || 'Release notes unavailable.');
            if (options?.markSeen) {
                await window.api.setLastSeenVersion(resolvedVersion);
            }
        } catch {
            setWhatsNewVersion(appVersion);
            setWhatsNewNotes('Release notes unavailable.');
            if (options?.markSeen) {
                await window.api.setLastSeenVersion(appVersion);
            }
        }
    };

    useEffect(() => {
        if (!isUnlocked || autoWhatsNewCheckedRef.current || !window.api) return;
        autoWhatsNewCheckedRef.current = true;

        const maybeOpenWhatsNew = async () => {
            try {
                const state = await window.api.shouldShowWhatsNew();
                if (state?.shouldShow) {
                    await openWhatsNew({ markSeen: true });
                }
            } catch {
                // ignore
            }
        };

        void maybeOpenWhatsNew();
    }, [isUnlocked]);

    /* ───────────────── Ordering ───────────────── */
    const orderedAccounts = (() => {
        const byId = new Map(accounts.map((a) => [a.id, a]));
        const ordered = accountOrder.map((id) => byId.get(id)).filter(Boolean) as Account[];
        // Append any accounts not in the order
        const inOrder = new Set(accountOrder);
        for (const a of accounts) {
            if (!inOrder.has(a.id)) ordered.push(a);
        }
        return ordered;
    })();

    const filteredAccounts = searchQuery.trim()
        ? orderedAccounts.filter((a) =>
            a.nickname.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (accountApiNames[a.id] || '').toLowerCase().includes(searchQuery.toLowerCase())
        )
        : orderedAccounts;

    /* ───────────────── Drag reorder ───────────────── */
    const handleDragStart = (index: number) => (e: React.DragEvent) => {
        dragSourceIndex.current = index;
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (index: number) => (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverIndex(index);
    };

    const handleDrop = (targetIndex: number) => (_e: React.DragEvent) => {
        const sourceIndex = dragSourceIndex.current;
        if (sourceIndex < 0 || sourceIndex === targetIndex) return;
        setAccountOrder((prev) => {
            const next = [...prev];
            const [moved] = next.splice(sourceIndex, 1);
            next.splice(targetIndex, 0, moved);
            saveOrder(next);
            return next;
        });
        setDragOverIndex(-1);
        dragSourceIndex.current = -1;
    };

    const handleDragEnd = () => {
        setDragOverIndex(-1);
        dragSourceIndex.current = -1;
    };

    /* ───────────────── Keyboard shortcuts ───────────────── */
    useEffect(() => {
        if (!isUnlocked) return;
        const handler = (e: KeyboardEvent) => {
            // Don't handle shortcuts when modals are open or input is focused
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
            if (isAddModalOpen || isSettingsOpen || isWhatsNewOpen) return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                setEditingAccount(undefined);
                setIsAddModalOpen(true);
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                setSearchOpen(true);
                setTimeout(() => searchInputRef.current?.focus(), 50);
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.min(prev + 1, filteredAccounts.length - 1));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, 0));
                return;
            }
            if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < filteredAccounts.length) {
                e.preventDefault();
                const acc = filteredAccounts[selectedIndex];
                const st = accountStatuses[acc.id];
                const isActive = activeAccountIds.includes(acc.id);
                if (isActive || st === 'stopping') {
                    handleStop(acc.id);
                } else if (st !== 'launching') {
                    handleLaunch(acc.id);
                }
                return;
            }
            if (e.key === 'Escape') {
                if (searchOpen) {
                    setSearchOpen(false);
                    setSearchQuery('');
                }
                setSelectedIndex(-1);
                return;
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isUnlocked, filteredAccounts, selectedIndex, isAddModalOpen, isSettingsOpen, isWhatsNewOpen, searchOpen, accountStatuses, activeAccountIds]);

    /* ───────────────── Delete from context menu ───────────────── */
    const handleDeleteFromMenu = async (id: string) => {
        const acc = accounts.find((a) => a.id === id);
        if (!acc) return;
        if (!confirm(`Delete account "${acc.nickname}"? This cannot be undone.`)) return;
        await handleDeleteAccount(id);
    };

    if (isAuthChecking) {
        return (
            <div className="axi-window">
                <TitleBar
                    minimal
                    version={appVersion}
                    isDev={showDevChrome}
                    updateState={updateState}
                    onWhatsNew={() => { void openWhatsNew(); }}
                    onMinimize={minimize}
                    onMaximize={maximize}
                    onClose={close}
                />
                <div className="am-mark" aria-hidden="true" />
                <ToastContainer />
            </div>
        );
    }

    if (!isUnlocked) {
        return (
            <div className="axi-window">
                <TitleBar
                    minimal
                    version={appVersion}
                    isDev={showDevChrome}
                    updateState={updateState}
                    onWhatsNew={() => { void openWhatsNew(); }}
                    onMinimize={minimize}
                    onMaximize={maximize}
                    onClose={close}
                />
                <div className="am-mark" aria-hidden="true" />
                <MasterPasswordModal
                    mode={masterPasswordMode}
                    onSubmit={handleMasterPasswordSubmit}
                    error={masterPasswordError}
                />
                <ToastContainer />
            </div>
        );
    }

    const cycleTheme = () => {
        const currentIndex = ACCENTS.findIndex((t) => t.id === currentThemeId);
        const nextIndex = (currentIndex + 1) % ACCENTS.length;
        const next = ACCENTS[nextIndex];
        setCurrentThemeId(next.id);
        applyTheme(next.id);
        // Also persist via settings
        window.api.getSettings().then((settings) => {
            window.api.saveSettings({ ...settings, themeId: next.id } as any);
        });
    };

    return (
        <div className="axi-window">
            <TitleBar
                version={appVersion}
                isDev={showDevChrome}
                updateState={updateState}
                onWhatsNew={() => { void openWhatsNew(); }}
                onMinimize={minimize}
                onMaximize={maximize}
                onClose={close}
            />
            <div className="am-mark" aria-hidden="true" />

            {/* Main layout: rail + content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Rail */}
                <nav className="am-rail">
                    <img src="img/axiam-glyph.svg" alt="AxiAM" className="w-5 h-5 object-contain" />

                    <Tooltip text="Add Account (Ctrl+N)" position="right">
                        <button
                            onClick={() => { setEditingAccount(undefined); setIsAddModalOpen(true); }}
                            className="am-rail-btn am-rail-btn--accent no-drag"
                        >
                            <Plus size={16} />
                        </button>
                    </Tooltip>

                    {accounts.length > 0 && (
                        <Tooltip text="Search (Ctrl+F)" position="right">
                            <button
                                onClick={() => { setSearchOpen(!searchOpen); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                                className="am-rail-btn no-drag"
                            >
                                <Search size={15} />
                            </button>
                        </Tooltip>
                    )}

                    <hr style={{ width: 22, border: 0, borderTop: 'var(--axi-border-hairline) solid var(--axi-rule)' }} />

                    <Tooltip text="What's New" position="right">
                        <button
                            onClick={() => { void openWhatsNew(); }}
                            className="am-rail-btn no-drag"
                        >
                            <Sparkles size={14} />
                        </button>
                    </Tooltip>

                    <Tooltip text="Cycle Theme" position="right">
                        <button
                            onClick={cycleTheme}
                            className="am-rail-btn no-drag"
                        >
                            <Palette size={15} />
                        </button>
                    </Tooltip>

                    <div className="flex-1" />

                    <Tooltip text="Settings" position="right">
                        <button
                            onClick={() => setIsSettingsOpen(true)}
                            className="am-rail-btn no-drag"
                        >
                            <Settings size={16} />
                        </button>
                    </Tooltip>
                </nav>

                {/* Content area */}
                <div className="flex-1 flex flex-col overflow-hidden relative">
                    {/* Search bar */}
                    {searchOpen && (
                        <div className="axi-search" style={{ margin: '10px 12px 0' }}>
                            <Search size={14} className="axi-search__icon" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setSelectedIndex(0); }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        setSearchOpen(false);
                                        setSearchQuery('');
                                    }
                                }}
                                className="axi-input"
                                placeholder="Search accounts…"
                                autoFocus
                            />
                        </div>
                    )}

                    {/* Account list */}
                    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 relative z-10">
                        {accountsLoading ? (
                            <SkeletonCards count={3} />
                        ) : accounts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full">
                                <div className="axi-panel flex flex-col items-center gap-3 text-center" style={{ ['--axi-panel-pad' as string]: '20px' }}>
                                    <p className="axi-eyebrow" style={{ margin: 0 }}>No accounts yet</p>
                                    <button
                                        onClick={() => { setEditingAccount(undefined); setIsAddModalOpen(true); }}
                                        className="axi-btn axi-btn--dashed"
                                    >
                                        <Plus size={16} /> Add your first account
                                    </button>
                                </div>
                            </div>
                        ) : filteredAccounts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full">
                                <div className="axi-panel text-center" style={{ ['--axi-panel-pad' as string]: '20px' }}>
                                    <p className="axi-eyebrow" style={{ margin: 0 }}>No matching accounts</p>
                                </div>
                            </div>
                        ) : (
                            filteredAccounts.map((account, index) => (
                                <AccountCard
                                    key={account.id}
                                    account={account}
                                    onLaunch={handleLaunch}
                                    onStop={handleStop}
                                    isActiveProcess={activeAccountIds.includes(account.id)}
                                    status={accountStatuses[account.id] ?? 'idle'}
                                    statusCertainty={accountStatusCertainty[account.id]}
                                    accountApiName={accountApiNames[account.id] || ''}
                                    isBirthday={isBirthday(accountApiCreatedAt[account.id])}
                                    onEdit={handleEditAccount}
                                    onDelete={handleDeleteFromMenu}
                                    index={index}
                                    selected={index === selectedIndex}
                                    onSelect={() => setSelectedIndex(index)}
                                    hasLocalDat={accountHasLocalDat[account.id] ?? false}
                                    onDragStart={handleDragStart(index)}
                                    onDragOver={handleDragOver(index)}
                                    onDragEnd={handleDragEnd}
                                    onDrop={handleDrop(index)}
                                    isDragOver={dragOverIndex === index}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            <AddAccountModal
                isOpen={isAddModalOpen}
                onClose={() => {
                    setIsAddModalOpen(false);
                    loadAccounts();
                }}
                onSave={handleSaveAccount}
                onDelete={handleDeleteAccount}
                onClearLogin={handleClearLogin}
                hasLocalDat={editingAccount ? (accountHasLocalDat[editingAccount.id] ?? false) : false}
                initialData={editingAccount}
            />

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />

            {isWhatsNewOpen && (
                <WhatsNewScreen
                    version={whatsNewVersion}
                    releaseNotes={whatsNewNotes}
                    onClose={() => setIsWhatsNewOpen(false)}
                />
            )}

            <ContextMenuContainer />
            <ToastContainer />
        </div>
    );
}

function loadSavedOrder(): string[] {
    try {
        const raw = localStorage.getItem('axiam_account_order');
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return [];
}

function saveOrder(order: string[]) {
    try {
        localStorage.setItem('axiam_account_order', JSON.stringify(order));
    } catch { /* ignore */ }
}

function isBirthday(createdAt?: string): boolean {
    if (import.meta.env.VITE_FORCE_BIRTHDAY === '1') return true;
    if (!createdAt) return false;
    const createdDate = new Date(createdAt);
    if (Number.isNaN(createdDate.getTime())) return false;
    const today = new Date();
    return createdDate.getMonth() === today.getMonth() && createdDate.getDate() === today.getDate();
}

function mapLaunchPhaseToStatus(phase: LaunchPhase): 'idle' | 'launching' | 'running' | 'stopping' | 'errored' | null {
    if (phase === 'launch_requested' || phase === 'patching' || phase === 'launcher_started' || phase === 'credentials_waiting' || phase === 'credentials_submitted') {
        return 'launching';
    }
    if (phase === 'process_detected' || phase === 'running') return 'running';
    if (phase === 'stopping') return 'stopping';
    if (phase === 'errored') return 'errored';
    if (phase === 'stopped' || phase === 'idle') return 'idle';
    return null;
}

export default App;
