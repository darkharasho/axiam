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
        <div className="flex flex-col items-center justify-center h-full p-6 relative overflow-hidden">
            {/* Vignette overlay */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)',
                }}
            />

            {/* Ambient glow behind card */}
            <div
                className="absolute pointer-events-none"
                style={{
                    width: '300px',
                    height: '300px',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'radial-gradient(circle, var(--theme-accent-soft) 0%, transparent 70%)',
                    animation: 'lockGlow 3s ease-in-out infinite',
                    filter: 'blur(40px)',
                }}
            />

            {/* Logo watermark */}
            <div
                className="absolute pointer-events-none opacity-[0.06]"
                style={{
                    width: '280px',
                    height: '280px',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -55%)',
                    background: 'radial-gradient(circle at 30% 25%, var(--theme-gold-strong) 0%, var(--theme-accent) 100%)',
                    WebkitMaskImage: "url('/img/AxiAM.svg')",
                    WebkitMaskRepeat: 'no-repeat',
                    WebkitMaskPosition: 'center',
                    WebkitMaskSize: 'contain',
                    maskImage: "url('/img/AxiAM.svg')",
                    maskRepeat: 'no-repeat',
                    maskPosition: 'center',
                    maskSize: 'contain',
                    animation: 'lockFloat 4s ease-in-out infinite',
                }}
            />

            <div className="glass-strong rounded-2xl p-8 w-full max-w-sm flex flex-col items-center relative z-10 modal-content-reveal">
                {/* Floating lock icon */}
                <div
                    className="rounded-2xl p-4 mb-5"
                    style={{
                        background: 'linear-gradient(135deg, var(--theme-accent-soft), color-mix(in srgb, var(--theme-accent) 15%, transparent))',
                        animation: 'lockFloat 3s ease-in-out infinite',
                        boxShadow: '0 0 30px 8px var(--theme-accent-soft)',
                    }}
                >
                    <Lock size={28} className="text-[var(--theme-gold-strong)]" />
                </div>

                <h2 className="text-xl font-bold text-white mb-1" style={{ fontFamily: '"Cinzel", serif' }}>
                    {mode === 'set' ? 'Create Vault' : 'Welcome Back'}
                </h2>

                {/* Decorative line */}
                <div className="w-12 h-px mb-4 mt-1" style={{ background: 'linear-gradient(90deg, transparent, var(--theme-gold), transparent)' }} />

                <p className="text-[var(--theme-text-muted)] text-center mb-6 text-[13px] leading-relaxed font-light">
                    {mode === 'set'
                        ? 'Create a master password to encrypt your account data. This cannot be recovered if lost.'
                        : 'Enter your master password to unlock.'}
                </p>

                <form onSubmit={handleSubmit} className="w-full space-y-3">
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="input-glass text-center text-lg tracking-[0.2em] py-3"
                        placeholder="Master Password"
                        required
                        autoFocus
                    />

                    {mode === 'set' && (
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="input-glass text-center text-lg tracking-[0.2em] py-3"
                            placeholder="Confirm Password"
                            required
                        />
                    )}

                    {error && (
                        <p className="text-[var(--theme-danger-text)] text-xs text-center font-medium">{error}</p>
                    )}

                    <button
                        type="submit"
                        className="btn-primary w-full py-3 text-sm font-semibold mt-2"
                    >
                        {mode === 'set' ? 'Create Vault' : 'Unlock'}
                    </button>

                    {mode === 'verify' && (
                        <button
                            type="button"
                            onClick={() => window.api.resetApp()}
                            className="btn-danger w-full py-2 text-xs mt-1"
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
