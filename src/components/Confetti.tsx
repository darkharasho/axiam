import { useEffect, useRef } from 'react';

interface ConfettiProps {
    active: boolean;
    onDone?: () => void;
}

const PARTICLE_COUNT = 50;
const DURATION = 1800;
const COLORS = [
    'var(--theme-accent-strong)',
    'var(--theme-gold)',
    'var(--theme-gold-strong)',
    'var(--theme-accent)',
    '#fff',
];

export default function Confetti({ active, onDone }: ConfettiProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef<number | null>(null);

    useEffect(() => {
        if (!active) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const styles = getComputedStyle(document.documentElement);
        const resolveColor = (c: string) => {
            if (c.startsWith('var(')) {
                const varName = c.slice(4, -1);
                return styles.getPropertyValue(varName).trim() || '#fff';
            }
            return c;
        };

        const particles = Array.from({ length: PARTICLE_COUNT }, () => {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
            const speed = 3 + Math.random() * 6;
            return {
                x: canvas.width / 2 + (Math.random() - 0.5) * 100,
                y: canvas.height * 0.6,
                vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 2,
                vy: Math.sin(angle) * speed * 1.5,
                size: 3 + Math.random() * 4,
                color: resolveColor(COLORS[Math.floor(Math.random() * COLORS.length)]),
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.3,
                gravity: 0.08 + Math.random() * 0.04,
                opacity: 1,
                decay: 0.012 + Math.random() * 0.008,
            };
        });

        const start = performance.now();

        const animate = (now: number) => {
            const elapsed = now - start;
            if (elapsed > DURATION) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                onDone?.();
                return;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            for (const p of particles) {
                p.x += p.vx;
                p.vy += p.gravity;
                p.y += p.vy;
                p.rotation += p.rotSpeed;
                p.opacity = Math.max(0, p.opacity - p.decay);

                if (p.opacity <= 0) continue;

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation);
                ctx.globalAlpha = p.opacity;
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
                ctx.restore();
            }

            animRef.current = requestAnimationFrame(animate);
        };

        animRef.current = requestAnimationFrame(animate);

        return () => {
            if (animRef.current) cancelAnimationFrame(animRef.current);
        };
    }, [active, onDone]);

    if (!active) return null;

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 pointer-events-none"
            style={{ zIndex: 99998 }}
        />
    );
}
