'use client';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ImageOff } from 'lucide-react';
import { linkHost, safeUrlTransform } from '@/lib/markdown-safety';

type Variant = 'chat' | 'report';

/** Seul point de rendu du Markdown produit par le LLM : aucune image chargée, liens limités à https:/mailto:/ancres. */
function components(variant: Variant): Components {
  // Le rapport est toujours rendu sur fond blanc (y compris pour l'export PDF) : on reprend ses couleurs fixes plutôt que les tokens du thème.
  const marker = variant === 'report' ? 'border-slate-300 text-slate-500' : 'border-line text-muted';
  const link = variant === 'report' ? 'underline' : 'text-brand-blue underline';
  const base: Components = {
    img: ({ alt }) => {
      const label = typeof alt === 'string' && alt.trim() ? ` : ${alt.trim().slice(0, 80)}` : '';
      return (
        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 text-[12px] ${marker}`}>
          <ImageOff size={12} aria-hidden />Image non affichée (protection des données){label}
        </span>
      );
    },
    a: ({ href, children }) => {
      if (!href) return <span>{children}</span>;
      if (href.startsWith('#')) return <a href={href} className={link}>{children}</a>;
      const host = linkHost(href);
      const title = host ? `Lien externe vers ${host}` : undefined;
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" title={title} className={link}>
          {children}
        </a>
      );
    },
  };
  if (variant === 'report') return base;
  return {
    ...base,
    pre: ({ children }) => <pre className="relative my-2 overflow-x-auto rounded-2xl bg-brand-navy p-3 font-mono text-[12px] text-sky-100">{children}</pre>,
    table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
  };
}

const CHAT = components('chat');
const REPORT = components('report');

export default function SafeMarkdown({ text, className, variant = 'chat' }: { text: string; className?: string; variant?: Variant }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrlTransform} skipHtml components={variant === 'report' ? REPORT : CHAT}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
