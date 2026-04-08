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
import { Plus, Settings, Minus, Square, X, RefreshCw, Sparkles, Search, Palette } from 'lucide-react';
import AmbientParticles from './components/AmbientParticles.tsx';
import SkeletonCards from './components/SkeletonCards.tsx';
import { GW2_THEMES } from './themes/themes';
import { ContextMenuContainer } from './components/ContextMenu.tsx';
import Confetti from './components/Confetti.tsx';
import Tooltip from './components/Tooltip.tsx';

type LaunchPhase = 'idle' | 'launch_requested' | 'launcher_started' | 'credentials_waiting' | 'credentials_submitted' | 'process_detected' | 'running' | 'stopping' | 'stopped' | 'errored';
type LaunchCertainty = 'verified' | 'inferred';
type LaunchStateInfo = { accountId: string; phase: LaunchPhase; certainty: LaunchCertainty; updatedAt: number; note?: string };

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
    const [showConfetti, setShowConfetti] = useState(false);
    const hasEverLaunchedRef = useRef(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [currentThemeId, setCurrentThemeId] = useState('blood_legion');

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
            const themeId = settings?.themeId || 'blood_legion';
            applyTheme(themeId);
            setCurrentThemeId(themeId);
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
                showToast('GW2 did not report as launched. Check Steam and launcher state.');
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

    const handleSaveLogin = async (id: string) => {
        try {
            const result = await window.api.saveLocalDat(id);
            if (result.success) {
                setAccountHasLocalDat((prev) => ({ ...prev, [id]: true }));
                showToast('Login saved for this account.');
            } else {
                showToast(result.message);
            }
        } catch {
            showToast('Failed to save login.');
        }
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

    // Auto-save Local.dat when an account stops running and has no saved copy
    const prevStatusesRef = useRef<Record<string, string>>({});
    useEffect(() => {
        const prev = prevStatusesRef.current;
        for (const [id, status] of Object.entries(accountStatuses)) {
            if (status === 'idle' && prev[id] === 'running' && !accountHasLocalDat[id]) {
                handleSaveLogin(id);
            }
        }
        prevStatusesRef.current = { ...accountStatuses };
    }, [accountStatuses]);

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
    const updateShortLabel = updatePhase === 'checking'
        ? 'Checking'
        : updatePhase === 'downloading'
            ? (updateProgress !== null ? `${Math.round(updateProgress)}%` : 'Downloading')
            : updatePhase === 'ready'
                ? 'Restart'
                : updatePhase === 'up_to_date' || updatePhase === 'dismissing'
                    ? 'Up to date'
                : 'Error';
    const updateIndicatorClass = `update-indicator ${updatePhase === 'error'
        ? 'update-indicator--error'
        : updatePhase === 'ready'
            ? 'update-indicator--ready'
            : ''} ${updatePhase === 'dismissing' ? 'update-indicator--exit' : ''}`;

    const renderUpdateIndicator = () => {
        if (!showUpdateIndicator) return null;
        const progressWidth = updateProgress === null ? 28 : Math.max(8, Math.min(100, Math.round(updateProgress)));
        const content = (
            <>
                {(updatePhase === 'checking' || updatePhase === 'downloading') && (
                    <span className="update-indicator__state update-indicator__state--checking" aria-hidden="true">
                        <span className="update-indicator__ring" />
                        <RefreshCw size={10} className="update-indicator__spinner animate-spin" />
                    </span>
                )}
                {updatePhase === 'ready' && <span className="update-indicator__state bg-emerald-300" aria-hidden="true" />}
                {(updatePhase === 'up_to_date' || updatePhase === 'dismissing') && <span className="update-indicator__state bg-emerald-300" aria-hidden="true" />}
                {updatePhase === 'error' && <span className="update-indicator__state bg-rose-300" aria-hidden="true" />}
                <span>{updateShortLabel}</span>
                {updatePhase === 'downloading' && (
                    <span className="update-indicator__progress" aria-hidden="true">
                        <span className="update-indicator__progress-fill" style={{ width: `${progressWidth}%` }} />
                        <span className="update-indicator__progress-shimmer" />
                    </span>
                )}
            </>
        );

        if (updatePhase === 'ready') {
            return (
                <button
                    type="button"
                    className={`${updateIndicatorClass} cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98]`}
                    title={updateIndicatorText}
                    style={{ WebkitAppRegion: 'no-drag' } as any}
                    onClick={() => window.api?.restartApp()}
                >
                    {content}
                </button>
            );
        }

        return (
            <span className={updateIndicatorClass} title={updateIndicatorText}>
                {content}
            </span>
        );
    };

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

    /* ───────────────── Confetti ───────────────── */
    const handleLaunchWithConfetti = async (id: string) => {
        await handleLaunch(id);
        if (!hasEverLaunchedRef.current) {
            const stored = localStorage.getItem('axiam_has_launched');
            if (!stored) {
                hasEverLaunchedRef.current = true;
                localStorage.setItem('axiam_has_launched', '1');
                setShowConfetti(true);
            } else {
                hasEverLaunchedRef.current = true;
            }
        }
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
                    handleLaunchWithConfetti(acc.id);
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

    /* ───────────────── Title Bar ───────────────── */
    const TitleBar = ({ minimal }: { minimal?: boolean }) => (
        <div
            className={`h-9 titlebar flex justify-between items-center px-3 select-none relative z-10 ${showDevChrome ? 'border-b border-[#f59e0b]' : ''}`}
            style={{ WebkitAppRegion: 'drag' } as any}
        >
            <span className="text-sm font-semibold text-[var(--theme-title)] flex items-center gap-2">
                <img src="img/AxiAM.png" alt="AxiAM" className="w-5 h-5 object-contain" />
                <span style={{ fontFamily: '"Cinzel", serif', letterSpacing: '0.06em', fontWeight: 700 }}>
                    <span className="text-white">Axi</span><span style={{ color: 'var(--theme-accent-strong)' }}>AM</span>
                </span>
                {showDevChrome ? (
                    <span className="ml-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.3em] text-amber-300">
                        Dev
                    </span>
                ) : null}
                {!showDevChrome ? <span className="text-[10px] font-normal text-[var(--theme-text-dim)] opacity-60">v{appVersion}</span> : null}
                {renderUpdateIndicator()}
            </span>
            <div className="flex items-center gap-0.5 relative z-50" style={{ WebkitAppRegion: 'no-drag' } as any}>
                <button
                    onClick={() => { void openWhatsNew(); }}
                    className="window-btn"
                    title="What's New"
                >
                    <Sparkles size={13} />
                </button>
                {!minimal && (
                    <>
                        <button onClick={minimize} className="window-btn"><Minus size={14} /></button>
                        <button onClick={maximize} className="window-btn"><Square size={11} /></button>
                    </>
                )}
                <button onClick={close} className="window-btn window-btn--close"><X size={14} /></button>
            </div>
        </div>
    );

    if (isAuthChecking) {
        return (
            <div className="h-screen w-screen text-white flex flex-col">
                <TitleBar minimal />
                <ToastContainer />
            </div>
        );
    }

    if (!isUnlocked) {
        return (
            <div className="h-screen w-screen text-white flex flex-col">
                <TitleBar minimal />
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
        const currentIndex = GW2_THEMES.findIndex((t) => t.id === currentThemeId);
        const nextIndex = (currentIndex + 1) % GW2_THEMES.length;
        const next = GW2_THEMES[nextIndex];
        setCurrentThemeId(next.id);
        applyTheme(next.id);
        // Also persist via settings
        window.api.getSettings().then((settings) => {
            window.api.saveSettings({ ...settings, themeId: next.id } as any);
        });
    };

    return (
        <div className={`h-screen w-screen text-white flex flex-col overflow-hidden relative ${showDevChrome ? 'border border-[#f59e0b]' : ''}`}>
            <div className="axiam-mark" aria-hidden="true" />
            <AmbientParticles />

            {/* Compact title bar — just drag region + window controls */}
            <div
                className={`h-8 titlebar flex justify-between items-center px-2 select-none relative z-12 ${showDevChrome ? 'border-b border-[#f59e0b]' : ''}`}
                style={{ WebkitAppRegion: 'drag' } as any}
            >
                <span className="flex items-center gap-1.5 text-[10px] text-[var(--theme-text-dim)]">
                    {showDevChrome ? (
                        <span className="rounded-full border border-amber-500/50 bg-amber-500/15 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.2em] text-amber-300">
                            Dev
                        </span>
                    ) : (
                        <span className="font-light opacity-60">v{appVersion}</span>
                    )}
                    {renderUpdateIndicator()}
                </span>
                <div className="flex items-center gap-0.5 relative z-50" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    <button onClick={minimize} className="window-btn !w-6 !h-6"><Minus size={12} /></button>
                    <button onClick={maximize} className="window-btn !w-6 !h-6"><Square size={9} /></button>
                    <button onClick={close} className="window-btn window-btn--close !w-6 !h-6"><X size={12} /></button>
                </div>
            </div>

            {/* Main layout: sidebar + content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <nav className="sidebar">
                    <img src="img/AxiAM.png" alt="AxiAM" className="sidebar-logo" />

                    <Tooltip text="Add Account (Ctrl+N)" position="right">
                        <button
                            onClick={() => { setEditingAccount(undefined); setIsAddModalOpen(true); }}
                            className="sidebar-btn sidebar-btn--accent"
                        >
                            <Plus size={16} />
                        </button>
                    </Tooltip>

                    {accounts.length > 0 && (
                        <Tooltip text="Search (Ctrl+F)" position="right">
                            <button
                                onClick={() => { setSearchOpen(!searchOpen); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                                className={`sidebar-btn ${searchOpen ? 'sidebar-btn--active' : ''}`}
                            >
                                <Search size={15} />
                            </button>
                        </Tooltip>
                    )}

                    <div className="sidebar-divider" />

                    <Tooltip text="What's New" position="right">
                        <button
                            onClick={() => { void openWhatsNew(); }}
                            className="sidebar-btn"
                        >
                            <Sparkles size={14} />
                        </button>
                    </Tooltip>

                    <Tooltip text="Cycle Theme" position="right">
                        <button
                            onClick={cycleTheme}
                            className="sidebar-btn"
                        >
                            <Palette size={15} />
                        </button>
                    </Tooltip>

                    <div className="flex-1" />

                    <Tooltip text="Settings" position="right">
                        <button
                            onClick={() => setIsSettingsOpen(true)}
                            className={`sidebar-btn ${isSettingsOpen ? 'sidebar-btn--active' : ''}`}
                        >
                            <Settings size={16} />
                        </button>
                    </Tooltip>
                </nav>

                {/* Content area */}
                <div className="flex-1 flex flex-col overflow-hidden relative">
                    {/* Search bar */}
                    {searchOpen && (
                        <div className={`px-3 pt-2 relative z-10 ${searchOpen ? 'search-bar-enter' : ''}`}>
                            <div className="flex items-center gap-2 glass rounded-xl px-3 py-1.5">
                                <Search size={14} className="text-[var(--theme-text-dim)] shrink-0" />
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
                                    className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-text-dim)] select-text"
                                    placeholder="Search accounts..."
                                    autoFocus
                                />
                                <button
                                    onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                                    className="window-btn !w-6 !h-6"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Account list */}
                    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 relative z-10">
                        {accountsLoading ? (
                            <SkeletonCards count={3} />
                        ) : accounts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full empty-state">
                                <div className="empty-state-icon mb-4">
                                    <div className="w-16 h-16 rounded-2xl glass flex items-center justify-center">
                                        <Plus size={28} className="text-[var(--theme-text-dim)]" />
                                    </div>
                                </div>
                                <p className="text-sm text-[var(--theme-text-dim)] mb-4 font-light">No accounts yet</p>
                                <button
                                    onClick={() => { setEditingAccount(undefined); setIsAddModalOpen(true); }}
                                    className="btn-primary px-5 py-2.5 text-sm flex items-center gap-2"
                                >
                                    <Plus size={16} /> Add Account
                                </button>
                            </div>
                        ) : filteredAccounts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-[var(--theme-text-dim)]">
                                <p className="text-sm font-light">No matching accounts</p>
                            </div>
                        ) : (
                            filteredAccounts.map((account, index) => (
                                <AccountCard
                                    key={account.id}
                                    account={account}
                                    onLaunch={handleLaunchWithConfetti}
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
                onResaveLogin={handleSaveLogin}
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
            <Confetti active={showConfetti} onDone={() => setShowConfetti(false)} />
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
    if (phase === 'launch_requested' || phase === 'launcher_started' || phase === 'credentials_waiting' || phase === 'credentials_submitted') {
        return 'launching';
    }
    if (phase === 'process_detected' || phase === 'running') return 'running';
    if (phase === 'stopping') return 'stopping';
    if (phase === 'errored') return 'errored';
    if (phase === 'stopped' || phase === 'idle') return 'idle';
    return null;
}

export default App;
