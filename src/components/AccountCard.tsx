import React, { useState, useEffect, useRef } from 'react';
import { Account } from '../types';
import { Loader2, Play, Settings, Square, ChevronDown, Trash2, Copy } from 'lucide-react';
import { showContextMenu } from './ContextMenu';
import Tooltip from './Tooltip';

interface AccountCardProps {
    account: Account;
    onLaunch: (id: string) => void;
    onStop: (id: string) => void;
    isActiveProcess: boolean;
    status: 'idle' | 'launching' | 'running' | 'stopping' | 'errored';
    statusCertainty?: 'verified' | 'inferred';
    accountApiName: string;
    isBirthday: boolean;
    onEdit: (account: Account) => void;
    onDelete?: (id: string) => void;
    index?: number;
    selected?: boolean;
    onSelect?: () => void;
    hasLocalDat?: boolean;
    // Drag props
    onDragStart?: (e: React.DragEvent) => void;
    onDragOver?: (e: React.DragEvent) => void;
    onDragEnd?: () => void;
    onDrop?: (e: React.DragEvent) => void;
    isDragOver?: boolean;
}

const getStatusLabel = (status: 'idle' | 'launching' | 'running' | 'stopping' | 'errored') => {
    if (status === 'launching') return 'Launching';
    if (status === 'running') return 'Running';
    if (status === 'stopping') return 'Stopping';
    if (status === 'errored') return 'Errored';
    return 'Idle';
};

const getStatusDotClass = (status: 'idle' | 'launching' | 'running' | 'stopping' | 'errored') => {
    if (status === 'running') return 'status-dot status-dot--running';
    if (status === 'launching') return 'status-dot status-dot--launching';
    if (status === 'stopping') return 'status-dot status-dot--stopping';
    if (status === 'errored') return 'status-dot status-dot--errored';
    return 'status-dot status-dot--idle';
};

const getStatusTextColor = (status: 'idle' | 'launching' | 'running' | 'stopping' | 'errored') => {
    if (status === 'running') return 'text-[var(--theme-accent-strong)]';
    if (status === 'launching') return 'text-[var(--theme-gold)]';
    if (status === 'errored') return 'text-[var(--theme-danger-text)]';
    return 'text-[var(--theme-text-dim)]';
};

function stringToHue(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
}

const BirthdayGiftIcon: React.FC = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="10" width="18" height="10" rx="2" fill="var(--theme-accent)" opacity="0.85" />
        <rect x="3" y="7" width="18" height="4" rx="1.5" fill="var(--theme-gold)" />
        <rect x="11" y="7" width="2" height="13" fill="var(--theme-gold-strong)" />
        <path d="M12 7C12 5.2 13.4 4 15 4C15.9 4 16.7 4.4 17.2 5.1C17.7 5.8 17.9 6.7 17.7 7H12Z" fill="var(--theme-accent-strong)" />
        <path d="M12 7C12 5.2 10.6 4 9 4C8.1 4 7.3 4.4 6.8 5.1C6.3 5.8 6.1 6.7 6.3 7H12Z" fill="var(--theme-accent-strong)" />
    </svg>
);

const AccountCard: React.FC<AccountCardProps> = ({
    account, onLaunch, onStop, isActiveProcess, status, statusCertainty,
    accountApiName, isBirthday, onEdit, onDelete, index = 0, selected, onSelect,
    hasLocalDat,
    onDragStart, onDragOver, onDragEnd, onDrop, isDragOver,
}) => {
    const effectiveStatus = (status === 'launching' || status === 'stopping' || status === 'errored')
        ? status
        : (isActiveProcess ? 'running' : status);
    const showStopControl = isActiveProcess || status === 'stopping';
    const launchInProgress = status === 'launching';
    const stopInProgress = status === 'stopping';
    const actionDisabled = launchInProgress || stopInProgress;
    const isRunning = effectiveStatus === 'running';

    // Expansion
    const [expanded, setExpanded] = useState(false);

    // Ripple state
    const [showRipple, setShowRipple] = useState(false);
    const rippleTimer = useRef<number | null>(null);

    // Success flash
    const [showSuccess, setShowSuccess] = useState(false);
    const prevStatus = useRef(effectiveStatus);

    useEffect(() => {
        if (prevStatus.current === 'launching' && effectiveStatus === 'running') {
            setShowSuccess(true);
            const t = window.setTimeout(() => setShowSuccess(false), 600);
            return () => window.clearTimeout(t);
        }
        prevStatus.current = effectiveStatus;
    }, [effectiveStatus]);

    // Dragging
    const [dragging, setDragging] = useState(false);

    const handlePlayClick = () => {
        setShowRipple(true);
        if (rippleTimer.current) window.clearTimeout(rippleTimer.current);
        rippleTimer.current = window.setTimeout(() => setShowRipple(false), 500);

        if (showStopControl) {
            onStop(account.id);
        } else {
            onLaunch(account.id);
        }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const items = [
            {
                label: showStopControl ? 'Stop Game' : 'Launch Game',
                icon: showStopControl ? <Square size={14} /> : <Play size={14} />,
                onClick: () => showStopControl ? onStop(account.id) : onLaunch(account.id),
                disabled: actionDisabled,
            },
            {
                label: 'Edit Account',
                icon: <Settings size={14} />,
                onClick: () => onEdit(account),
            },
            {
                label: 'Copy Nickname',
                icon: <Copy size={14} />,
                onClick: () => navigator.clipboard.writeText(account.nickname),
            },
            { label: '', onClick: () => {}, divider: true },
            {
                label: 'Delete Account',
                icon: <Trash2 size={14} />,
                onClick: () => onDelete?.(account.id),
                danger: true,
            },
        ];
        showContextMenu(e.clientX, e.clientY, items);
    };

    const hue = stringToHue(account.nickname);
    const initial = account.nickname.charAt(0);

    return (
        <div
            className={`glass rounded-xl p-3 card-hover card-enter ${isRunning ? 'card-running' : ''} ${selected ? 'card-selected' : ''} ${dragging ? 'card-dragging' : ''} ${isDragOver ? 'card-drag-over' : ''}`}
            style={{
                animationDelay: `${index * 60}ms`,
                borderColor: isRunning ? 'var(--theme-active-border)' : undefined,
                boxShadow: isRunning
                    ? '0 0 0 1px var(--theme-active-ring), 0 4px 20px -8px rgba(0,0,0,0.3)'
                    : '0 2px 12px -4px rgba(0,0,0,0.2)',
                cursor: 'default',
            }}
            onClick={onSelect}
            onContextMenu={handleContextMenu}
            draggable
            onDragStart={(e) => {
                setDragging(true);
                onDragStart?.(e);
            }}
            onDragOver={onDragOver}
            onDragEnd={() => {
                setDragging(false);
                onDragEnd?.();
            }}
            onDrop={onDrop}
        >
            {/* Main row */}
            <div className="flex items-center justify-between">
                {/* Left side: avatar + name + status */}
                <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
                    <div
                        className="avatar-initial"
                        style={{
                            background: `hsl(${hue}, 45%, 25%)`,
                            color: `hsl(${hue}, 50%, 75%)`,
                        }}
                    >
                        {initial}
                    </div>
                    <div className="flex flex-col min-w-0 gap-0.5">
                        <span className="font-semibold text-[0.9rem] text-[var(--theme-text)] truncate leading-tight" title={account.nickname}>
                            {account.nickname}
                        </span>
                        <div className="status-chip">
                            <span className={getStatusDotClass(effectiveStatus)} />
                            <span className={`text-[11px] font-medium ${getStatusTextColor(effectiveStatus)}`}
                                  title={statusCertainty ? `State certainty: ${statusCertainty}` : undefined}>
                                {getStatusLabel(effectiveStatus)}
                            </span>
                            {accountApiName && (
                                <span className="text-[10px] text-[var(--theme-text-dim)] truncate max-w-[100px] ml-1 opacity-70" title={accountApiName}>
                                    {accountApiName}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right side: actions */}
                <div className="flex items-center gap-1 ml-3">
                    {isBirthday && (
                        <Tooltip text="Account birthday">
                            <span className="inline-flex items-center justify-center opacity-90">
                                <BirthdayGiftIcon />
                            </span>
                        </Tooltip>
                    )}
                    <Tooltip text={launchInProgress ? 'Launching...' : (stopInProgress ? 'Stopping...' : (showStopControl ? 'Stop Game' : 'Launch Game'))}>
                        <button
                            onClick={(e) => { e.stopPropagation(); handlePlayClick(); }}
                            className="btn-play p-2 text-white disabled:opacity-60 disabled:cursor-not-allowed relative"
                            disabled={actionDisabled}
                        >
                            {showRipple && <span className="btn-play-ripple"><span /></span>}
                            {showSuccess && <span className="success-flash" />}
                            {launchInProgress
                                ? <Loader2 size={16} className="animate-spin relative z-10" />
                                : (showStopControl ? <Square size={14} fill="currentColor" className="relative z-10" /> : <Play size={16} fill="currentColor" className="relative z-10" />)}
                        </button>
                    </Tooltip>
                    <Tooltip text="Expand details">
                        <button
                            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                            className="window-btn"
                        >
                            <ChevronDown
                                size={14}
                                style={{
                                    transition: 'transform 0.25s ease',
                                    transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                }}
                            />
                        </button>
                    </Tooltip>
                    <Tooltip text="Edit Account">
                        <button
                            onClick={(e) => { e.stopPropagation(); onEdit(account); }}
                            className="window-btn"
                        >
                            <Settings size={15} />
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* Expandable details */}
            <div className={`card-details ${expanded ? 'card-details--expanded' : 'card-details--collapsed'}`}>
                <div className="border-t border-[color-mix(in_srgb,var(--theme-border)_40%,transparent)] mt-2 pt-2 space-y-1.5">
                    {accountApiName && (
                        <div className="flex items-center gap-2 text-[11px]">
                            <span className="text-[var(--theme-text-dim)]">API Name</span>
                            <span className="text-[var(--theme-text-muted)]">{accountApiName}</span>
                        </div>
                    )}
                    {account.launchArguments && (
                        <div className="flex items-center gap-2 text-[11px]">
                            <span className="text-[var(--theme-text-dim)]">Args</span>
                            <span className="text-[var(--theme-text-muted)] truncate font-mono text-[10px]">{account.launchArguments}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-[var(--theme-text-dim)]">Login</span>
                        <span className="text-[var(--theme-text-muted)]">{hasLocalDat ? 'Saved' : 'Not saved'}</span>
                    </div>
                    {statusCertainty && (
                        <div className="flex items-center gap-2 text-[11px]">
                            <span className="text-[var(--theme-text-dim)]">Certainty</span>
                            <span className="text-[var(--theme-text-muted)] capitalize">{statusCertainty}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AccountCard;
