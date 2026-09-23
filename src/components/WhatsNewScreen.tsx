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
      className="axi-scrim flex flex-col"
      style={{ top: 38, WebkitAppRegion: 'no-drag' } as any}
    >
      {/* Header */}
      <div className="h-11 px-4 flex items-center justify-between" style={{ borderBottom: 'var(--axi-border-hairline) solid var(--axi-rule)' }}>
        <button
          onClick={animateClose}
          className="am-rail-btn"
          title="Close What's New"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <X size={16} />
        </button>
        <span className="axi-eyebrow" style={{ margin: 0 }}>What's New</span>
        <span className="axi-chip">v{version}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-3xl mx-auto">
          <div className="axi-panel">
            <div className="axi-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {releaseNotes || 'Release notes unavailable.'}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
