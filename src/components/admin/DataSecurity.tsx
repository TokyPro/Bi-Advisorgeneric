'use client';
import { useRef, useState } from 'react';
import { Download, Upload, ShieldCheck, Trash2, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import { exportConfig, importConfig } from '@/lib/backup';
import { clearSecrets, listSecretNames } from '@/lib/vault';
import { Field, inputCls, Spinner } from '../ui/primitives';

export default function DataSecurity() {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const sessions = useStore((s) => s.sessions.length);
  const secrets = listSecretNames().length;

  const wrap = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast.error('Opération impossible', { description: (e as Error).message }); } setBusy(false); };
  const check = () => { if (pass.length < 8) { toast.error('Mot de passe trop court', { description: '8 caractères minimum.' }); return false; } return true; };

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="mb-3 flex items-start gap-3"><ShieldCheck className="mt-0.5 text-emerald-500" size={20} /><div><h2 className="text-lg font-bold">Modèle de sécurité</h2>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-muted"><li>Clés API et identifiants : chiffrés AES-GCM, clé de chiffrement <b>non exportable</b> (IndexedDB), jamais stockés côté serveur.</li><li>Connecteurs SQL / Mongo / Odoo : lecture seule imposée.</li><li>{secrets} secret(s) enregistré(s) dans ce navigateur · {sessions} session(s) d’analyse.</li><li>Il n’y a pas de compte utilisateur : toute personne ayant accès à ce navigateur voit la configuration. En déploiement partagé, placez l’application derrière une authentification (reverse-proxy, SSO).</li></ul></div></div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-bold">Sauvegarde / migration de la configuration</h2>
        <p className="mb-4 text-sm text-muted">Exporte réglages LLM, connexions et secrets dans un fichier chiffré par mot de passe (PBKDF2 + AES-GCM), pour les retrouver sur un autre navigateur ou poste.</p>
        <Field label="Mot de passe de sauvegarde (8 caractères min.)"><div className="relative"><KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className={inputCls + ' pl-9'} autoComplete="new-password" /></div></Field>
        <div className="mt-3 flex gap-2">
          <button disabled={busy} onClick={() => check() && wrap(async () => { await exportConfig(pass); toast.success('Sauvegarde chiffrée téléchargée'); })} className="btn-grad flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60">{busy ? <Spinner /> : <Download size={15} />}Exporter</button>
          <button disabled={busy} onClick={() => check() && file.current?.click()} className="flex items-center gap-2 rounded-full border border-line px-5 py-2 text-sm font-semibold hover:bg-surface2"><Upload size={15} />Importer…</button>
          <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) wrap(async () => { const r = await importConfig(f, pass); toast.success('Configuration importée', { description: `${r.secrets} secret(s), ${r.sources} connexion(s). Actualisez les connexions pour recharger leurs données.` }); }); }} />
        </div>
      </section>

      <section className="card border-red-200 p-5">
        <h2 className="text-lg font-bold text-red-600">Zone dangereuse</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => { if (confirm('Supprimer toutes les clés API et identifiants de ce navigateur ?')) { clearSecrets(); useStore.setState({ keyStatus: {} }); toast('Secrets supprimés'); } }} className="flex items-center gap-2 rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 size={14} />Effacer les secrets</button>
          <button onClick={() => { if (confirm('Effacer TOUTES les données de BI Advisor dans ce navigateur (sessions, sources, secrets) ?')) { clearSecrets(); localStorage.removeItem('bi-advisor:state'); indexedDB.deleteDatabase('bi-advisor-vault'); location.href = '/'; } }} className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"><Trash2 size={14} />Réinitialiser l’application</button>
        </div>
      </section>
    </div>
  );
}
