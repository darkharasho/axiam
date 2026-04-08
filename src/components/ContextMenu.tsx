import { useEffect, useRef, useState, useCallback } from 'react';

export interface ContextMenuItem {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
    divider?: boolean;
}

interface ContextMenuState {
    x: number;
    y: number;
    items: ContextMenuItem[];
}

let showMenuGlobal: ((state: ContextMenuState) => void) | null = null;

export function showContextMenu(x: number, y: number, items: ContextMenuItem[]) {
    showMenuGlobal?.({ x, y, items });
}

export function ContextMenuContainer() {
    const [menu, setMenu] = useState<ContextMenuState | null>(null);
    const [closing, setClosing] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        showMenuGlobal = setMenu;
        return () => { showMenuGlobal = null; };
    }, []);

    const close = useCallback(() => {
        setClosing(true);
        setTimeout(() => {
            setMenu(null);
            setClosing(false);
        }, 150);
    }, []);

    useEffect(() => {
        if (!menu) return;
        const handleClick = () => close();
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        window.addEventListener('click', handleClick);
        window.addEventListener('keydown', handleKey);
        window.addEventListener('blur', close);
        return () => {
            window.removeEventListener('click', handleClick);
            window.removeEventListener('keydown', handleKey);
            window.removeEventListener('blur', close);
        };
    }, [menu, close]);

    if (!menu) return null;

    // Clamp position to stay within viewport
    const menuWidth = 180;
    const menuHeight = menu.items.length * 32 + 12;
    const x = Math.min(menu.x, window.innerWidth - menuWidth - 8);
    const y = Math.min(menu.y, window.innerHeight - menuHeight - 8);

    return (
        <div
            ref={ref}
            className={`context-menu ${closing ? 'context-menu--exit' : ''}`}
            style={{ left: x, top: y }}
            onClick={(e) => e.stopPropagation()}
        >
            {menu.items.map((item, i) => (
                item.divider ? (
                    <div key={i} className="context-menu-divider" />
                ) : (
                    <button
                        key={i}
                        className={`context-menu-item ${item.danger ? 'context-menu-item--danger' : ''}`}
                        onClick={() => {
                            if (!item.disabled) {
                                close();
                                item.onClick();
                            }
                        }}
                        disabled={item.disabled}
                    >
                        {item.icon && <span className="context-menu-icon">{item.icon}</span>}
                        {item.label}
                    </button>
                )
            ))}
        </div>
    );
}
