import React, { useState, useRef, useEffect } from 'react';

interface TooltipProps {
    text: string;
    children: React.ReactElement;
    delay?: number;
    position?: 'top' | 'bottom' | 'right';
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
                if (position === 'right') {
                    setCoords({
                        x: rect.right,
                        y: rect.top + rect.height / 2,
                    });
                } else {
                    setCoords({
                        x: rect.left + rect.width / 2,
                        y: position === 'top' ? rect.top : rect.bottom,
                    });
                }
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
                        left: position === 'right' ? coords.x + 8 : coords.x,
                        top: position === 'right' ? coords.y : (position === 'top' ? coords.y - 6 : coords.y + 6),
                        transform: position === 'right'
                            ? 'translate(0, -50%)'
                            : position === 'top'
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
