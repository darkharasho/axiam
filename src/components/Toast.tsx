import { useEffect, useState } from 'react';

type ToastType = 'error' | 'info';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
    exiting: boolean;
}

let nextId = 0;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function notify() {
    listeners.forEach((fn) => fn());
}

export function showToast(message: string, type: ToastType = 'error') {
    const id = nextId++;
    const toast: Toast = { id, message, type, exiting: false };
    toasts = [...toasts, toast];
    notify();

    setTimeout(() => {
        toasts = toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t));
        notify();
        setTimeout(() => {
            toasts = toasts.filter((t) => t.id !== id);
            notify();
        }, 300);
    }, 5000);
}

export function ToastContainer() {
    const [, setTick] = useState(0);

    useEffect(() => {
        const listener = () => setTick((t) => t + 1);
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-1.5 pointer-events-none">
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={`pointer-events-auto px-3 py-1.5 rounded-md shadow-lg text-xs transition-all duration-300 ${
                        toast.exiting ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
                    } bg-[var(--theme-surface-soft)] text-[var(--theme-text)] border border-[var(--theme-border)]`}
                >
                    {toast.message}
                </div>
            ))}
        </div>
    );
}
