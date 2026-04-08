import React, { useState, useRef, useEffect } from 'react';

interface TooltipProps {
    text: string;
    children: React.ReactElement;
    delay?: number;
    position?: 'top' | 'bottom';
}

export default function Tooltip({ text, children, delay = 400, position = 'top' }: TooltipProps) {
    const [visible, setVisible] = useState(false);
    const [coords, setCoords] = useState({ x: 0, y: 0 });
    const timerRef = useRef<number | null>(null);
    const triggerRef = useRef<HTMLDivElement>(null);

    const show = () => {
        timerRef.current = window.setTimeout(() => {
            if (triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                setCoords({
                    x: rect.left + rect.width / 2,
                    y: position === 'top' ? rect.top : rect.bottom,
                });
            }
            setVisible(true);
        }, delay);
    };

    const hide = () => {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        setVisible(false);
    };

    useEffect(() => {
        return () => {
            if (timerRef.current) window.clearTimeout(timerRef.current);
        };
    }, []);

    if (!text) return children;

    return (
        <div
            ref={triggerRef}
            onMouseEnter={show}
            onMouseLeave={hide}
            onMouseDown={hide}
            className="inline-flex"
        >
            {React.cloneElement(children, { title: undefined })}
            {visible && (
                <div
                    className="tooltip-bubble"
                    style={{
                        position: 'fixed',
                        left: coords.x,
                        top: position === 'top' ? coords.y - 6 : coords.y + 6,
                        transform: position === 'top'
                            ? 'translate(-50%, -100%)'
                            : 'translate(-50%, 0)',
                        zIndex: 99999,
                    }}
                >
                    {text}
                </div>
            )}
        </div>
    );
}
