import React, { useState } from 'react';
import { Account } from '../types';
import { Loader2, Play, Settings, Square, ChevronDown, Trash2, Copy } from 'lucide-react';
import { showContextMenu } from './ContextMenu';
import Tooltip from './Tooltip';

type Status = 'idle' | 'launching' | 'running' | 'stopping' | 'errored';

interface AccountCardProps {
    account: Account;
    onLaunch: (id: string) => void;
    onStop: (id: string) => void;
    isActiveProcess: boolean;
    status: Status;
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

const getStatusLabel = (status: Status) => {
    if (status === 'launching') return 'Launching';
    if (status === 'running') return 'Running';
    if (status === 'stopping') return 'Stopping';
    if (status === 'errored') return 'Errored';
    return 'Idle';
};

// Filled asserts, outlined annotates (rule 5).
const STATUS_CHIP: Record<Status, { cls: string; dot: string; work: boolean }> = {
    running:   { cls: 'axi-chip axi-chip--ok',     dot: 'am-status-dot--ok',     work: false },
    launching: { cls: 'axi-chip axi-chip--warn',   dot: 'am-status-dot--warn',   work: true },
    stopping:  { cls: 'axi-chip axi-chip--warn',   dot: 'am-status-dot--warn',   work: true },
    errored:   { cls: 'axi-chip axi-chip--danger', dot: 'am-status-dot--danger', work: false },
    idle:      { cls: 'axi-chip',                  dot: 'am-status-dot--idle',   work: false },
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
        <rect x="3" y="10" width="18" height="10" fill="var(--axi-accent)" />
        <rect x="3" y="7" width="18" height="4" fill="var(--axi-warn)" />
        <rect x="11" y="7" width="2" height="13" fill="var(--axi-ink-line)" />
        <path d="M12 7C12 5.2 13.4 4 15 4C15.9 4 16.7 4.4 17.2 5.1C17.7 5.8 17.9 6.7 17.7 7H12Z" fill="var(--axi-accent)" />
        <path d="M12 7C12 5.2 10.6 4 9 4C8.1 4 7.3 4.4 6.8 5.1C6.3 5.8 6.1 6.7 6.3 7H12Z" fill="var(--axi-accent)" />
    </svg>
);

const AccountCard: React.FC<AccountCardProps> = ({
    account, onLaunch, onStop, isActiveProcess, status, statusCertainty,
    accountApiName, isBirthday, onEdit, onDelete, selected, onSelect,
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

    // Dragging
    const [dragging, setDragging] = useState(false);

    const handlePlayClick = () => {
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

    const rowLabelStyle: React.CSSProperties = {
        font: 'var(--axi-t-micro)',
        textTransform: 'uppercase',
        color: 'var(--axi-text-faint)',
    };
    const rowValueStyle: React.CSSProperties = { color: 'var(--axi-text-dim)' };

    return (
        <div
            className={`am-card p-3 ${isRunning ? 'am-card--running' : ''} ${selected ? 'am-card--selected' : ''} ${dragging ? 'am-card--dragging' : ''} ${isDragOver ? 'am-card--drag-over' : ''}`}
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
                        className="am-avatar"
                        style={{
                            background: `hsl(${hue}, 45%, 25%)`,
                            color: `hsl(${hue}, 50%, 75%)`,
                        }}
                    >
                        {initial}
                    </div>
                    <div className="flex flex-col min-w-0 gap-0.5">
                        <span className="font-semibold text-[0.9rem] truncate leading-tight" style={{ color: 'var(--axi-text)' }} title={account.nickname}>
                            {account.nickname}
                        </span>
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className={STATUS_CHIP[effectiveStatus].cls}
                                  title={statusCertainty ? `State certainty: ${statusCertainty}` : undefined}>
                                <span className={`am-status-dot ${STATUS_CHIP[effectiveStatus].dot} ${STATUS_CHIP[effectiveStatus].work ? 'am-work' : ''}`} aria-hidden="true" />
                                {getStatusLabel(effectiveStatus)}
                            </span>
                            {statusCertainty === 'inferred' && (
                                <span className="axi-chip axi-chip--meta">Inferred</span>
                            )}
                            {accountApiName && (
                                <span style={{ color: 'var(--axi-text-faint)' }} className="text-[10px] truncate max-w-[100px]" title={accountApiName}>
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
                            <span className="am-rail-btn">
                                <BirthdayGiftIcon />
                            </span>
                        </Tooltip>
                    )}
                    <Tooltip text={launchInProgress ? 'Launching...' : (stopInProgress ? 'Stopping...' : (showStopControl ? 'Stop Game' : 'Launch Game'))}>
                        <button
                            onClick={(e) => { e.stopPropagation(); handlePlayClick(); }}
                            className="axi-btn axi-btn--primary no-drag"
                            style={{ padding: 8 }}
                            disabled={actionDisabled}
                        >
                            {launchInProgress
                                ? <Loader2 size={16} className="animate-spin" />
                                : (showStopControl ? <Square size={14} fill="currentColor" /> : <Play size={16} fill="currentColor" />)}
                        </button>
                    </Tooltip>
                    <Tooltip text="Expand details">
                        <button
                            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                            className="am-rail-btn"
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
                            className="am-rail-btn"
                        >
                            <Settings size={15} />
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* Expandable details */}
            <div
                style={{
                    overflow: 'hidden',
                    maxHeight: expanded ? 200 : 0,
                    opacity: expanded ? 1 : 0,
                    transition: 'max-height .25s ease, opacity .2s ease',
                }}
            >
                <div
                    className="flex flex-col gap-1.5"
                    style={{ borderTop: 'var(--axi-border-hairline) solid var(--axi-rule)', marginTop: 8, paddingTop: 8 }}
                >
                    {accountApiName && (
                        <div className="flex items-center gap-2 text-[11px]">
                            <span style={rowLabelStyle}>API Name</span>
                            <span style={rowValueStyle}>{accountApiName}</span>
                        </div>
                    )}
                    {account.launchArguments && (
                        <div className="flex items-center gap-2 text-[11px]">
                            <span style={rowLabelStyle}>Args</span>
                            <span style={rowValueStyle} className="truncate font-mono text-[10px]">{account.launchArguments}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-[11px]">
                        <span style={rowLabelStyle}>Login</span>
                        <span style={rowValueStyle}>{hasLocalDat ? 'Saved' : 'Not saved'}</span>
                    </div>
                    {statusCertainty && (
                        <div className="flex items-center gap-2 text-[11px]">
                            <span style={rowLabelStyle}>Certainty</span>
                            <span style={rowValueStyle} className="capitalize">{statusCertainty}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AccountCard;
