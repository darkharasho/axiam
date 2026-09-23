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
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        showMenuGlobal = setMenu;
        return () => { showMenuGlobal = null; };
    }, []);

    const close = useCallback(() => {
        setMenu(null);
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
            className="axi-menu__pop"
            style={{
                position: 'fixed', left: x, top: y, display: 'flex', flexDirection: 'column', gap: 2,
                '--axi-menu-width': `${menuWidth}px`,
            } as React.CSSProperties}
            onClick={(e) => e.stopPropagation()}
        >
            {menu.items.map((item, i) => (
                item.divider ? (
                    <div key={i} style={{ borderTop: 'var(--axi-border-hairline) solid var(--axi-rule)', margin: '4px 0' }} />
                ) : (
                    <button
                        key={i}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!item.disabled) {
                                close();
                                item.onClick();
                            }
                        }}
                        disabled={item.disabled}
                        className={item.danger ? 'am-menu-item am-menu-item--danger' : 'am-menu-item'}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            width: '100%', padding: '7px 8px',
                            font: 'var(--axi-t-label)', textAlign: 'left',
                        }}
                    >
                        {item.icon && <span style={{ display: 'inline-flex' }}>{item.icon}</span>}
                        {item.label}
                    </button>
                )
            ))}
        </div>
    );
}
