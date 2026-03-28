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
import { Plus, Settings, Minus, Square, X, RefreshCw, Sparkles, Zap } from 'lucide-react';

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
    const [isLinuxPrewarmAvailable, setIsLinuxPrewarmAvailable] = useState(false);
    const [isLinuxPrewarmRunning, setIsLinuxPrewarmRunning] = useState(false);
    const [updatePhase, setUpdatePhase] = useState<'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'up_to_date' | 'dismissing'>('idle');
    const [updateLabel, setUpdateLabel] = useState('');
    const [updateProgress, setUpdateProgress] = useState<number | null>(null);
    const [gw2UpdatePillPhase, setGw2UpdatePillPhase] = useState<'idle' | 'checking' | 'updating' | 'success' | 'error' | 'dismissing'>('idle');
    const [gw2UpdatePillLabel, setGw2UpdatePillLabel] = useState('');
    const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);
    const [whatsNewVersion, setWhatsNewVersion] = useState(appVersion);
    const [whatsNewNotes, setWhatsNewNotes] = useState<string>('Loading release notes...');
    const processMissCountsRef = useRef<Record<string, number>>({});
    const updateDismissTimerRef = useRef<number | null>(null);
    const updateHideTimerRef = useRef<number | null>(null);
    const gw2UpdatePillHideTimerRef = useRef<number | null>(null);
    const autoWhatsNewCheckedRef = useRef(false);

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
            applyTheme(settings?.themeId || 'blood_legion');
        });
        window.api.checkPortalPermissions().then((status) => {
            setIsLinuxPrewarmAvailable(status.message !== 'Only available on Linux');
        }).catch(() => {
            setIsLinuxPrewarmAvailable(false);
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
            const localDatStatus: Record<string, boolean> = {};
            for (const acc of loadedAccounts) {
                localDatStatus[acc.id] = await window.api.hasLocalDat(acc.id);
            }
            setAccountHasLocalDat(localDatStatus);
        } catch {
            showToast('Failed to load accounts.');
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

    const handleLinuxPrewarm = async () => {
        if (isLinuxPrewarmRunning) return;
        setIsLinuxPrewarmRunning(true);
        try {
            const result = await withTimeout(window.api.prewarmLinuxInputAuthorization(), 10_000, 'prewarmLinuxInputAuthorization');
            showToast(result.success ? result.message : `Failed: ${result.message}`);
        } catch {
            showToast('Failed to trigger Linux input prewarm.');
        } finally {
            setIsLinuxPrewarmRunning(false);
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

    // Auto-save Local.dat when an account starts running and has no saved copy
    const prevStatusesRef = useRef<Record<string, string>>({});
    useEffect(() => {
        const prev = prevStatusesRef.current;
        for (const [id, status] of Object.entries(accountStatuses)) {
            if (status === 'running' && prev[id] !== 'running' && !accountHasLocalDat[id]) {
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

    useEffect(() => {
        if (!window.api) return;

        const clearGw2PillTimer = () => {
            if (gw2UpdatePillHideTimerRef.current !== null) {
                window.clearTimeout(gw2UpdatePillHideTimerRef.current);
                gw2UpdatePillHideTimerRef.current = null;
            }
        };

        const dismissGw2Pill = (delayMs: number) => {
            clearGw2PillTimer();
            gw2UpdatePillHideTimerRef.current = window.setTimeout(() => {
                setGw2UpdatePillPhase('dismissing');
                gw2UpdatePillHideTimerRef.current = window.setTimeout(() => {
                    setGw2UpdatePillPhase('idle');
                    setGw2UpdatePillLabel('');
                }, 300);
            }, delayMs);
        };

        const updateGw2PillFromStatus = (status: {
            phase: 'idle' | 'queued' | 'starting' | 'running' | 'completed' | 'failed';
            mode: 'before_launch' | 'background' | 'manual';
            message?: string;
        }) => {
            const message = (status.message || '').trim();
            if (status.phase === 'queued' || status.phase === 'starting') {
                clearGw2PillTimer();
                setGw2UpdatePillPhase('checking');
                setGw2UpdatePillLabel(message || 'Checking GW2 update...');
                return;
            }
            if (status.phase === 'running') {
                clearGw2PillTimer();
                setGw2UpdatePillPhase('updating');
                setGw2UpdatePillLabel(message || 'Updating GW2...');
                return;
            }
            if (status.phase === 'completed') {
                clearGw2PillTimer();
                setGw2UpdatePillPhase('success');
                setGw2UpdatePillLabel(message || 'GW2 up to date');
                dismissGw2Pill(1800);
                return;
            }
            if (status.phase === 'failed') {
                clearGw2PillTimer();
                setGw2UpdatePillPhase('error');
                setGw2UpdatePillLabel(message || 'GW2 update failed');
                dismissGw2Pill(4500);
                return;
            }
            clearGw2PillTimer();
            setGw2UpdatePillPhase('idle');
            setGw2UpdatePillLabel('');
        };

        window.api.getGw2UpdateStatus().then((status) => {
            updateGw2PillFromStatus(status);
        }).catch(() => {
            // ignore
        });

        const unsubscribe = window.api.onGw2UpdateStatus((status) => {
            updateGw2PillFromStatus(status);
        });

        return () => {
            clearGw2PillTimer();
            unsubscribe();
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

    const renderGw2UpdatePill = () => {
        if (gw2UpdatePillPhase === 'idle') return null;
        const className = `gw2-update-pill ${gw2UpdatePillPhase === 'error'
            ? 'gw2-update-pill--error'
            : gw2UpdatePillPhase === 'success'
                ? 'gw2-update-pill--success'
                : ''} ${gw2UpdatePillPhase === 'dismissing' ? 'gw2-update-pill--exit' : ''}`;
        return (
            <span className={className} title={gw2UpdatePillLabel}>
                {(gw2UpdatePillPhase === 'checking' || gw2UpdatePillPhase === 'updating') && (
                    <RefreshCw size={10} className="animate-spin" />
                )}
                {(gw2UpdatePillPhase === 'success' || gw2UpdatePillPhase === 'dismissing') && <span className="gw2-update-pill__dot bg-emerald-300" aria-hidden="true" />}
                {gw2UpdatePillPhase === 'error' && <span className="gw2-update-pill__dot bg-rose-300" aria-hidden="true" />}
                <span>
                    {gw2UpdatePillPhase === 'checking'
                        ? 'Checking GW2'
                        : gw2UpdatePillPhase === 'updating'
                            ? 'Updating GW2'
                            : gw2UpdatePillPhase === 'success' || gw2UpdatePillPhase === 'dismissing'
                                ? 'GW2 up to date'
                                : 'GW2 update failed'}
                </span>
            </span>
        );
    };

    // Window controls
    const minimize = () => {
        console.log('Minimize clicked');
        if (window.api) window.api.minimizeWindow();
        else console.error('window.api is missing');
    };
    const maximize = () => {
        console.log('Maximize clicked');
        if (window.api) window.api.maximizeWindow();
        else console.error('window.api is missing');
    };
    const close = () => {
        console.log('Close clicked');
        if (window.api) window.api.closeWindow();
        else console.error('window.api is missing');
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

    if (isAuthChecking) {
        return (
            <div className="h-screen w-screen text-white flex flex-col">
                <div className={`h-8 bg-[var(--theme-surface)] border-b flex justify-between items-center px-2 select-none ${showDevChrome ? 'border-[#f59e0b]' : 'border-[var(--theme-border)]'}`} style={{ WebkitAppRegion: 'drag' } as any}>
                    <span className="text-xs font-bold ml-2 flex items-center gap-2">
                        <img src="img/GW2AM.png" alt="GW2AM" className="w-4 h-4 object-contain" />
                        GW2 AM
                        {showDevChrome ? (
                            <span className="ml-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.3em] text-amber-300">
                                Dev Build
                            </span>
                        ) : null}
                        {!showDevChrome ? <span className="text-[10px] font-normal text-[var(--theme-text-dim)]">v{appVersion}</span> : null}
                        {renderUpdateIndicator()}
                    </span>
                    <div className="flex space-x-2 relative z-50" style={{ WebkitAppRegion: 'no-drag' } as any}>
                        <button
                            onClick={() => { void openWhatsNew(); }}
                            className="p-1 hover:bg-[var(--theme-control-bg)] rounded transition-colors text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                            title="What's New"
                        >
                            <Sparkles size={12} />
                        </button>
                        <button onClick={close} className="p-1 hover:bg-[var(--theme-accent)] rounded transition-colors"><X size={12} /></button>
                    </div>
                </div>
                <ToastContainer />
            </div>
        );
    }

    if (!isUnlocked) {
        return (
            <div className="h-screen w-screen text-white flex flex-col">
                {/* Custom Title Bar */}
                <div className={`h-8 bg-[var(--theme-surface)] border-b flex justify-between items-center px-2 select-none ${showDevChrome ? 'border-[#f59e0b]' : 'border-[var(--theme-border)]'}`} style={{ WebkitAppRegion: 'drag' } as any}>
                    <span className="text-xs font-bold ml-2 flex items-center gap-2">
                        <img src="img/GW2AM.png" alt="GW2AM" className="w-4 h-4 object-contain" />
                        GW2 AM
                        {showDevChrome ? (
                            <span className="ml-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.3em] text-amber-300">
                                Dev Build
                            </span>
                        ) : null}
                        {!showDevChrome ? <span className="text-[10px] font-normal text-[var(--theme-text-dim)]">v{appVersion}</span> : null}
                        {renderUpdateIndicator()}
                    </span>
                    <div className="flex space-x-2 relative z-50" style={{ WebkitAppRegion: 'no-drag' } as any}>
                        <button
                            onClick={() => { void openWhatsNew(); }}
                            className="p-1 hover:bg-[var(--theme-control-bg)] rounded transition-colors text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                            title="What's New"
                        >
                            <Sparkles size={12} />
                        </button>
                        <button onClick={close} className="p-1 hover:bg-[var(--theme-accent)] rounded transition-colors"><X size={12} /></button>
                    </div>
                </div>
                <MasterPasswordModal
                    mode={masterPasswordMode}
                    onSubmit={handleMasterPasswordSubmit}
                    error={masterPasswordError}
                />
                <ToastContainer />
            </div>
        );
    }

    return (
        <div className={`h-screen w-screen text-white flex flex-col overflow-hidden border relative ${showDevChrome ? 'border-[#f59e0b]' : 'border-[var(--theme-border)]'}`}>
            <div className="gw2am-mark" aria-hidden="true" />
            {/* Custom Title Bar */}
            <div className={`h-9 bg-[var(--theme-surface)] flex justify-between items-center px-3 select-none border-b relative z-10 ${showDevChrome ? 'border-[#f59e0b]' : 'border-[var(--theme-border)]'}`} style={{ WebkitAppRegion: 'drag' } as any}>
                <span className="text-sm font-bold text-[var(--theme-title)] flex items-center gap-2">
                    <img src="img/GW2AM.png" alt="GW2AM" className="w-5 h-5 object-contain" />
                    GW2 AM
                    {showDevChrome ? (
                        <span className="ml-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.3em] text-amber-300">
                            Dev Build
                        </span>
                    ) : null}
                    {!showDevChrome ? <span className="text-[11px] font-normal text-[var(--theme-text-dim)]">v{appVersion}</span> : null}
                    {renderUpdateIndicator()}
                </span>
                <div className="flex space-x-1 relative z-50" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    <button
                        onClick={() => { void openWhatsNew(); }}
                        className="p-1 hover:bg-[var(--theme-control-bg)] rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
                        title="What's New"
                    >
                        <Sparkles size={13} />
                    </button>
                    <button onClick={minimize} className="p-1 hover:bg-[var(--theme-control-bg)] rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"><Minus size={14} /></button>
                    <button onClick={maximize} className="p-1 hover:bg-[var(--theme-control-bg)] rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"><Square size={12} /></button>
                    <button onClick={close} className="p-1 hover:bg-[var(--theme-accent)] rounded text-[var(--theme-text-muted)] hover:text-white transition-colors"><X size={14} /></button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 relative z-10">
                {accounts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-[var(--theme-text-dim)]">
                        <p>No accounts added yet.</p>
                        <button
                            onClick={() => { setEditingAccount(undefined); setIsAddModalOpen(true); }}
                            className="mt-4 px-4 py-2 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-strong)] text-white rounded-lg transition-colors flex items-center"
                        >
                            <Plus size={18} className="mr-2" /> Add Account
                        </button>
                    </div>
                ) : (
                    accounts.map(account => (
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
                        />
                    ))
                )}
            </div>

            <div className="p-4 bg-[var(--theme-surface)] border-t border-[var(--theme-border)] flex justify-between items-center relative">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-bg)] rounded-lg transition-colors"
                        title="Settings"
                    >
                        <Settings size={20} />
                    </button>
                    {isLinuxPrewarmAvailable && (
                        <button
                            onClick={() => { void handleLinuxPrewarm(); }}
                            disabled={isLinuxPrewarmRunning}
                            className="p-1.5 text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-bg)] disabled:opacity-60 disabled:cursor-not-allowed rounded-lg transition-colors"
                            title="Prewarm Input Authorization"
                        >
                            {isLinuxPrewarmRunning ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
                        </button>
                    )}
                    {renderGw2UpdatePill()}
                </div>

                {accounts.length > 0 && (
                    <button
                        onClick={() => { setEditingAccount(undefined); setIsAddModalOpen(true); }}
                        className="p-3 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-strong)] text-white rounded-full shadow-lg transition-all transform hover:scale-105"
                        title="Add Account"
                    >
                        <Plus size={24} />
                    </button>
                )}
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

            <ToastContainer />
        </div>
    );
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
