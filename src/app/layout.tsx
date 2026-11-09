import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'BI Advisor — Conseiller Business Intelligence',
  description: 'Interrogez, analysez et visualisez vos données avec le LLM de votre choix (BYOK).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: "try{var p=localStorage.getItem('bia_palette');if(p)document.documentElement.dataset.palette=p}catch(e){}" }} />
      </head>
      <body>
        {children}
        <Toaster position="top-right" richColors closeButton toastOptions={{ style: { borderRadius: 16, fontFamily: 'var(--font-jakarta)' } }} />
      </body>
    </html>
  );
}
