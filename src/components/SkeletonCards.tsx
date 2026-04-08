export default function SkeletonCards({ count = 3 }: { count?: number }) {
    return (
        <div className="space-y-2">
            {Array.from({ length: count }, (_, i) => (
                <div
                    key={i}
                    className="glass rounded-xl p-3 flex items-center gap-2.5 card-enter skeleton-shimmer"
                    style={{ animationDelay: `${i * 80}ms` }}
                >
                    <div className="skeleton-block w-8 h-8 rounded-[10px]" />
                    <div className="flex flex-col gap-1.5 flex-1">
                        <div className="skeleton-block h-3.5 rounded-md" style={{ width: `${50 + Math.random() * 30}%` }} />
                        <div className="skeleton-block h-2.5 rounded-md w-16" />
                    </div>
                    <div className="skeleton-block w-8 h-8 rounded-[10px]" />
                </div>
            ))}
        </div>
    );
}
