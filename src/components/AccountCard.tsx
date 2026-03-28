import React from 'react';
import { Account } from '../types';
import { Loader2, Play, Settings, Square } from 'lucide-react';

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
}

const getStatusChipClasses = (status: 'idle' | 'launching' | 'running' | 'stopping' | 'errored') => {
    if (status === 'running') return 'bg-[var(--theme-active-ring)] text-[var(--theme-text)] border-[var(--theme-active-border)]';
    if (status === 'launching') return 'bg-[color-mix(in_srgb,var(--theme-accent)_25%,transparent)] text-[var(--theme-title)] border-[var(--theme-accent)]';
    if (status === 'stopping') return 'bg-[color-mix(in_srgb,var(--theme-control-bg)_70%,transparent)] text-[var(--theme-text)] border-[var(--theme-border)]';
    if (status === 'errored') return 'bg-[var(--theme-danger-soft)] text-[var(--theme-danger-text)] border-[color-mix(in_srgb,var(--theme-danger-text)_40%,transparent)]';
    return 'bg-[color-mix(in_srgb,var(--theme-surface-soft)_70%,transparent)] text-[var(--theme-text-muted)] border-[var(--theme-border)]';
};

const getStatusLabel = (status: 'idle' | 'launching' | 'running' | 'stopping' | 'errored') => {
    if (status === 'launching') return 'Launching';
    if (status === 'running') return 'Running';
    if (status === 'stopping') return 'Stopping';
    if (status === 'errored') return 'Errored';
    return 'Idle';
};

const BirthdayGiftIcon: React.FC = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="10" width="18" height="10" rx="2" fill="var(--theme-accent)" opacity="0.85" />
        <rect x="3" y="7" width="18" height="4" rx="1.5" fill="var(--theme-gold)" />
        <rect x="11" y="7" width="2" height="13" fill="var(--theme-gold-strong)" />
        <path d="M12 7C12 5.2 13.4 4 15 4C15.9 4 16.7 4.4 17.2 5.1C17.7 5.8 17.9 6.7 17.7 7H12Z" fill="var(--theme-accent-strong)" />
        <path d="M12 7C12 5.2 10.6 4 9 4C8.1 4 7.3 4.4 6.8 5.1C6.3 5.8 6.1 6.7 6.3 7H12Z" fill="var(--theme-accent-strong)" />
    </svg>
);

const AccountCard: React.FC<AccountCardProps> = ({ account, onLaunch, onStop, isActiveProcess, status, statusCertainty, accountApiName, isBirthday, onEdit }) => {
    const effectiveStatus = (status === 'launching' || status === 'stopping' || status === 'errored')
        ? status
        : (isActiveProcess ? 'running' : status);
    const showStopControl = isActiveProcess || status === 'stopping';
    const launchInProgress = status === 'launching';
    const stopInProgress = status === 'stopping';
    const actionDisabled = launchInProgress || stopInProgress;

    return (
        <div className={`bg-[color-mix(in_srgb,var(--theme-surface)_44%,transparent)] backdrop-blur-md rounded-lg p-3 flex items-center justify-between hover:bg-[color-mix(in_srgb,var(--theme-surface-soft)_50%,transparent)] transition-colors border ${isActiveProcess ? 'border-[var(--theme-active-border)] shadow-[0_0_0_1px_var(--theme-active-ring)]' : 'border-[var(--theme-border)]'}`}>
            <div className="flex items-center gap-2 overflow-hidden min-w-0">
                <span className="font-bold text-base text-[var(--theme-text)] truncate" title={account.nickname}>{account.nickname}</span>
                <span className={`inline-flex shrink-0 items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${getStatusChipClasses(effectiveStatus)}`} title={statusCertainty ? `State certainty: ${statusCertainty}` : undefined}>
                        {getStatusLabel(effectiveStatus)}
                </span>
            </div>

            <div className="flex items-center space-x-2 ml-3">
                {accountApiName && (
                    <span className="text-xs text-[var(--theme-text-dim)]/80 truncate max-w-[140px]" title={accountApiName}>
                        {accountApiName}
                    </span>
                )}
                {isBirthday && (
                    <span className="inline-flex items-center justify-center opacity-90" title="Account birthday">
                        <BirthdayGiftIcon />
                    </span>
                )}
                <button
                    onClick={() => (showStopControl ? onStop(account.id) : onLaunch(account.id))}
                    className="p-1.5 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-strong)] text-white rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    title={launchInProgress ? 'Launching Game' : (stopInProgress ? 'Stopping Game' : (showStopControl ? 'Stop Game' : 'Launch Game'))}
                    disabled={actionDisabled}
                >
                    {launchInProgress
                        ? <Loader2 size={16} className="animate-spin" />
                        : (showStopControl ? <Square size={16} fill="currentColor" /> : <Play size={18} fill="currentColor" />)}
                </button>
                <button
                    onClick={() => onEdit(account)}
                    className="p-1.5 bg-[var(--theme-control-bg)] hover:bg-[var(--theme-control-hover)] text-[var(--theme-text)] rounded-md transition-colors"
                    title="Edit Account"
                >
                    <Settings size={16} />
                </button>
            </div>
        </div>
    );
};

export default AccountCard;
