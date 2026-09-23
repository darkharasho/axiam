import React, { useState } from 'react';
import { Lock } from 'lucide-react';

interface MasterPasswordModalProps {
    mode: 'set' | 'verify';
    onSubmit: (password: string) => void;
    error?: string;
}

const MasterPasswordModal: React.FC<MasterPasswordModalProps> = ({ mode, onSubmit, error }) => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (mode === 'set' && password !== confirmPassword) {
            alert("Passwords do not match!");
            return;
        }
        onSubmit(password);
    };

    return (
        <div
            className="flex-1 flex flex-col items-center justify-center p-6"
            style={{ background: 'var(--axi-ground)' }}
        >
            <div className="axi-panel flex flex-col items-center" style={{ maxWidth: 320, width: '100%' }}>
                <div
                    className="am-rail-btn am-rail-btn--accent"
                    style={{ width: 40, height: 40, marginBottom: 18 }}
                >
                    <Lock size={20} />
                </div>

                <h2 style={{ font: 'var(--axi-t-h2)', letterSpacing: 'var(--axi-ls-h2)', margin: '0 0 10px' }}>
                    {mode === 'set' ? 'Create Vault' : 'Welcome Back'}
                </h2>

                <p style={{ font: 'var(--axi-t-small)', color: 'var(--axi-text-dim)', textAlign: 'center', marginBottom: 22 }}>
                    {mode === 'set'
                        ? 'Create a master password to encrypt your account data. This cannot be recovered if lost.'
                        : 'Enter your master password to unlock.'}
                </p>

                <form onSubmit={handleSubmit} className="flex flex-col gap-3" style={{ width: '100%' }}>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="axi-input"
                        style={{ textAlign: 'center', fontSize: '1.125rem', letterSpacing: '0.2em', padding: '12px' }}
                        placeholder="Master Password"
                        required
                        autoFocus
                    />

                    {mode === 'set' && (
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="axi-input"
                            style={{ textAlign: 'center', fontSize: '1.125rem', letterSpacing: '0.2em', padding: '12px' }}
                            placeholder="Confirm Password"
                            required
                        />
                    )}

                    {error && (
                        <p style={{ color: 'var(--axi-danger)', font: 'var(--axi-t-small)', textAlign: 'center' }}>{error}</p>
                    )}

                    <button
                        type="submit"
                        className="axi-btn axi-btn--primary justify-center"
                        style={{ width: '100%', marginTop: 8 }}
                    >
                        {mode === 'set' ? 'Create Vault' : 'Unlock'}
                    </button>

                    {mode === 'verify' && (
                        <button
                            type="button"
                            onClick={() => window.api.resetApp()}
                            className="axi-btn axi-btn--ghost justify-center"
                            style={{ width: '100%', color: 'var(--axi-danger)' }}
                        >
                            Hard Reset (Clear Data)
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
};

export default MasterPasswordModal;
