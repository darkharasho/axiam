export default function SkeletonCards({ count = 3 }: { count?: number }) {
    return (
        <div className="flex flex-col gap-2">
            {Array.from({ length: count }, (_, i) => (
                <div key={i} className="am-card am-skeleton" style={{ height: 62 }} />
            ))}
        </div>
    );
}
