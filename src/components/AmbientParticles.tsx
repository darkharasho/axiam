import { useMemo } from 'react';

const PARTICLE_COUNT = 28;

interface Particle {
    id: number;
    left: string;
    size: number;
    duration: string;
    delay: string;
    opacity: number;
    drift: number;
}

export default function AmbientParticles() {
    const particles = useMemo<Particle[]>(() => {
        return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
            id: i,
            left: `${Math.random() * 100}%`,
            size: 1.5 + Math.random() * 2.5,
            duration: `${14 + Math.random() * 18}s`,
            delay: `${-Math.random() * 25}s`,
            opacity: 0.12 + Math.random() * 0.2,
            drift: -25 + Math.random() * 50,
        }));
    }, []);

    return (
        <div className="particle-field" aria-hidden="true">
            {particles.map((p) => (
                <span
                    key={p.id}
                    className="particle"
                    style={{
                        left: p.left,
                        width: `${p.size}px`,
                        height: `${p.size}px`,
                        animationDuration: p.duration,
                        animationDelay: p.delay,
                        '--particle-drift': `${p.drift}px`,
                        '--particle-opacity': p.opacity,
                    } as React.CSSProperties}
                />
            ))}
        </div>
    );
}
