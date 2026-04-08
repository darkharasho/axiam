import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';

interface WhatsNewScreenProps {
  version: string;
  releaseNotes: string;
  onClose: () => void;
}

const EXIT_MS = 250;

export default function WhatsNewScreen({ version, releaseNotes, onClose }: WhatsNewScreenProps) {
  const [closing, setClosing] = useState(false);

  const animateClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      onClose();
    }, EXIT_MS);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        animateClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closing]);

  return (
    <div
      className={`absolute left-0 right-0 bottom-0 top-9 z-[90] flex flex-col ${closing ? 'modal-fade-out' : 'modal-fade-in'}`}
      style={{ WebkitAppRegion: 'no-drag', background: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(8px)' } as any}
    >
      {/* Header */}
      <div className="h-11 px-4 border-b border-[color-mix(in_srgb,var(--theme-border)_60%,transparent)] flex items-center justify-between modal-content-reveal">
        <button
          onClick={animateClose}
          className="titlebar-btn p-1.5"
          title="Close What's New"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <X size={16} />
        </button>
        <span className="section-label tracking-widest">What's New</span>
        <span className="text-[10px] text-[var(--theme-text-dim)] font-light">v{version}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-3xl mx-auto space-y-4 text-[var(--theme-text)] modal-content-reveal" style={{ animationDelay: '100ms' }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="text-xl font-bold text-[var(--theme-title)]" style={{ fontFamily: '"Cinzel", serif' }}>{children}</h1>,
              h2: ({ children }) => <h2 className="text-lg font-semibold text-[var(--theme-title)] mt-5">{children}</h2>,
              h3: ({ children }) => <h3 className="text-base font-semibold text-[var(--theme-title)] mt-4">{children}</h3>,
              p: ({ children }) => <p className="leading-7 text-[var(--theme-text)] text-sm font-light">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-6 space-y-1 text-[var(--theme-text)] text-sm">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-6 space-y-1 text-[var(--theme-text)] text-sm">{children}</ol>,
              li: ({ children }) => <li className="leading-6 font-light">{children}</li>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-[var(--theme-accent)] pl-4 italic text-[var(--theme-text-dim)] text-sm">
                  {children}
                </blockquote>
              ),
              pre: ({ children }) => (
                <pre className="overflow-x-auto rounded-xl border border-[color-mix(in_srgb,var(--theme-border)_60%,transparent)] glass p-3 text-xs">
                  {children}
                </pre>
              ),
              code: ({ children }) => (
                <code className="rounded-md bg-[var(--theme-surface-soft)] px-1.5 py-0.5 text-[11px]">{children}</code>
              ),
            }}
          >
            {releaseNotes || 'Release notes unavailable.'}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
