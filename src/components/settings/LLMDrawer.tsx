'use client';
import { authFetch } from '@/lib/auth-client';
import { useEffect, useState } from 'react';
import { RefreshCw, Search, Eye, EyeOff, ShieldCheck, Trash2, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import { PROVIDERS, provider, fmtCtx, catalogOf } from '@/lib/llm/models';
import { validateKey, ensureModel } from '@/lib/llm/catalog';
import { getSecret, setSecret, removeSecret, hasSecret } from '@/lib/vault';
import type { ProviderId } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Drawer, Dot, Field, inputCls, Spinner } from '../ui/primitives';

export default function LLMDrawer() {
  const open = useStore((s) => s.ui.settings);
  const setUi = useStore((s) => s.setUi);
  return (
    <Drawer open={open} onClose={() => setUi({ settings: false })} title="Configuration LLM" subtitle="Apportez votre propre clé (BYOK)">
      <LLMPanel active={open} />
    </Drawer>
  );
}

export function LLMPanel({ active = true }: { active?: boolean }) {
  const open = active;
  const { llm, keyStatus } = useStore();
  const setLlm = useStore((s) => s.setLlm);
  const setKeyStatus = useStore((s) => s.setKeyStatus);
  const [pid, setPid] = useState<ProviderId>(llm.provider === 'demo' ? 'anthropic' : llm.provider);
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  useStore((s) => s.catalog);
  const models = catalogOf(pid);
  const p = provider(pid);
  const status = keyStatus[pid] ?? 'unknown';
  const baseUrl = llm.baseUrls?.[pid] ?? '';
  const hasBase = ['openai', 'deepseek', 'nvidia'].includes(pid);
  const setBase = (v: string) => setLlm({ baseUrls: { ...(llm.baseUrls || {}), [pid]: v } });

  useEffect(() => { setKey(''); setMsg(''); setShow(false); if (open && pid !== 'demo') getSecret('llm:' + pid).then((k) => { if (k) { setKey(k); if (!catalogOf(pid).length) validateKey(pid, k, useStore.getState().llm.baseUrls?.[pid]).then((r) => { setMsg(r.message); if (r.ok) ensureModel(pid, r.models); }); } }); setQ(''); }, [pid, open]);

  const test = async (k = key) => {
    if (!k.trim() && !(pid === 'nvidia' && baseUrl.trim())) { toast.error('Collez d’abord une clé API'); return false; }
    setMsg('');
    const r = await validateKey(pid, k, baseUrl);
    setMsg(r.message);
    return r.ok ? r : false;
  };
  const save = async () => {
    const r = await test();
    if (key.trim()) await setSecret('llm:' + pid, key.trim());
    else if (!(pid === 'nvidia' && baseUrl.trim())) return;
    if (r) { ensureModel(pid, r.models); toast.success(`Clé ${p.label} valide · ${r.models.length} modèle(s) chargé(s)`); }
    else toast.warning('Clé enregistrée mais le test a échoué', { description: 'Vérifiez la clé ou votre réseau.' });
  };
  const del = () => { removeSecret('llm:' + pid); setKey(''); setKeyStatus(pid, 'unknown'); setMsg(''); if (llm.provider === pid) setLlm({ provider: 'demo', model: 'demo-advisor', customModel: '' }); toast('Clé supprimée de ce navigateur'); };

  return (
      <div className="space-y-5 p-6">
        <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
          <ShieldCheck size={18} className="mt-0.5 shrink-0" />
          <p>Votre clé est chiffrée (AES-GCM) et stockée <b>uniquement dans ce navigateur</b>. Elle n’est jamais enregistrée côté serveur : elle transite seulement lors d’un appel, via le proxy de l’application.</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.filter((x) => x.id !== 'demo').map((x) => (
            <button key={x.id} onClick={() => setPid(x.id)} className={cn('flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm font-semibold transition', pid === x.id ? 'border-brand-violet bg-brand-violet/10' : 'border-line hover:bg-surface2')}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} />{x.label}
              <span className="ml-auto"><Dot status={keyStatus[x.id] ?? 'unknown'} /></span>
            </button>
          ))}
        </div>

        <Field label={`Clé API ${p.label}`} hint={`Format : ${p.keyHint}`}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input type={show ? 'text' : 'password'} value={key} onChange={(e) => { setKey(e.target.value); setKeyStatus(pid, 'unknown'); setMsg(''); }} placeholder={p.keyHint} autoComplete="off" spellCheck={false} className={cn(inputCls, 'pr-9 font-mono')} />
              <button onClick={() => setShow(!show)} aria-label="Afficher" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
            {hasSecret('llm:' + pid) && <button onClick={del} aria-label="Supprimer la clé" className="rounded-xl border border-line p-2 text-muted hover:text-red-500"><Trash2 size={16} /></button>}
          </div>
        </Field>

        {hasBase && (
          <Field label="URL de base (optionnel)" hint={p.baseUrlHint || 'Pour un proxy / serveur compatible API OpenAI. Laissez vide pour le service officiel.'}>
            <input value={baseUrl} onChange={(e) => { setBase(e.target.value); setKeyStatus(pid, 'unknown'); }} placeholder={pid === 'nvidia' ? 'https://integrate.api.nvidia.com/v1' : 'https://…/v1'} className={cn(inputCls, 'font-mono')} />
          </Field>
        )}

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={status === 'testing'} className="btn-grad flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60">{status === 'testing' && <Spinner />}Enregistrer & tester</button>
          <button onClick={() => test()} disabled={status === 'testing'} className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-surface2">Tester</button>
          <a href={p.docs} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-xs text-muted hover:text-fg">Obtenir une clé<ExternalLink size={12} /></a>
        </div>

        {status !== 'unknown' && status !== 'testing' && (
          <div className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium', status === 'ok' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300')}>
            {status === 'ok' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}{msg || (status === 'ok' ? 'Connexion établie' : 'Clé invalide')}
          </div>
        )}

        {status === 'ok' ? (
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Modèle</div>
          {models.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line p-4 text-center text-xs text-muted">Aucun modèle chargé. Validez votre clé API : la liste des modèles disponibles est récupérée en direct auprès de {p.label}.</p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <div className="relative flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filtrer ${models.length} modèles…`} className={cn(inputCls, 'pl-8')} /></div>
                <button onClick={() => test()} aria-label="Actualiser les modèles" title="Actualiser la liste" className="rounded-xl border border-line p-2 text-muted hover:text-fg"><RefreshCw size={16} /></button>
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {models.filter((m) => !q || (m.id + m.label).toLowerCase().includes(q.toLowerCase())).map((m) => {
                  const act = llm.provider === pid && llm.model === m.id && !llm.customModel;
                  return (
                    <button key={m.id} onClick={() => { setLlm({ provider: pid, model: m.id, customModel: '' }); toast.success(`${m.label} sélectionné`); }}
                      className={cn('w-full rounded-2xl border p-3 text-left transition', act ? 'border-brand-violet bg-brand-violet/10' : 'border-line hover:bg-surface2')}>
                      <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold">{m.label}</span>{act && <span className="rounded-full bg-brand-violet px-2 py-0.5 text-[10px] font-bold text-white">ACTIF</span>}</div>
                      <div className="mt-0.5 flex gap-4 text-[11.5px] text-muted">{m.label !== m.id && <span className="truncate font-mono">{m.id}</span>}{m.context ? <span>Contexte : <b className="text-fg">{fmtCtx(m.context)}</b></span> : null}</div>
                    </button>
                  );
                })}
              </div>
              {llm.provider === pid && !llm.customModel && llm.model && !models.some((m) => m.id === llm.model) && <p className="mt-2 text-[11.5px] text-amber-600">Le modèle actif « {llm.model} » n’est pas dans la liste actuelle de ce fournisseur : choisissez-en un autre.</p>}
            </>
          )}
          <Field label="ID de modèle personnalisé (optionnel)" hint="Pour un modèle non listé (accès restreint, préversion) : saisissez son ID exact.">
            <input value={llm.provider === pid ? llm.customModel : ''} onChange={(e) => setLlm({ provider: pid, customModel: e.target.value })} placeholder="ex. nom-exact-du-modèle" className={cn(inputCls, 'mt-2 font-mono')} />
          </Field>
          <Pricing pid={pid} />
        </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-line p-4 text-center text-xs text-muted">Validez votre clé API {p.label} pour charger la liste des modèles disponibles et en choisir un.</p>
        )}

        <div className="space-y-3 rounded-2xl border border-line p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-muted">Réglages de génération</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Température : ${llm.temperature}`}><input type="range" min={0} max={1} step={0.05} value={llm.temperature} onChange={(e) => setLlm({ temperature: Number(e.target.value) })} className="w-full accent-brand-violet" /></Field>
            <Field label="Tokens de sortie max"><input type="number" min={256} max={32000} step={256} value={llm.maxTokens} onChange={(e) => setLlm({ maxTokens: Math.max(256, Number(e.target.value) || 4096) })} className={inputCls} /></Field>
          </div>
          <Field label="Consignes d’administrateur" hint="Ajoutées au prompt système : devise, vocabulaire métier, règles de calcul, ton…">
            <textarea rows={3} value={llm.instructions} onChange={(e) => setLlm({ instructions: e.target.value })} placeholder="Ex. Les montants sont en Ariary (MGA). Exercice fiscal = année civile." className={inputCls} />
          </Field>
        </div>

        <button onClick={() => { setLlm({ provider: 'demo', model: 'demo-advisor', customModel: '' }); toast.success('Mode démo hors-ligne activé'); }} className="w-full rounded-2xl border border-dashed border-line py-2.5 text-sm font-semibold text-muted hover:bg-surface2">Utiliser le moteur démo (sans clé)</button>
      </div>
  );
}

/** Les API ne publient pas les tarifs : saisie optionnelle ($/M tokens) pour estimer les coûts. */
function Pricing({ pid }: { pid: ProviderId }) {
  const { llm } = useStore();
  const setLlm = useStore((s) => s.setLlm);
  const model = llm.provider === pid ? llm.customModel || llm.model : '';
  if (!model) return null;
  const k = `${pid}:${model}`;
  const cur = llm.pricing?.[k] ?? { in: 0, out: 0 };
  const set = (v: Partial<{ in: number; out: number }>) => setLlm({ pricing: { ...(llm.pricing || {}), [k]: { ...cur, ...v } } });
  return (
    <div className="mt-3 rounded-2xl border border-line p-3">
      <div className="text-[11.5px] text-muted">Tarifs de <b className="text-fg">{model}</b> (optionnel, $ par million de tokens) — non fournis par l’API ; sans eux, aucun coût n’est estimé.</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="Entrée"><input type="number" min={0} step={0.01} value={cur.in || ''} onChange={(e) => set({ in: Number(e.target.value) || 0 })} className={inputCls} /></Field>
        <Field label="Sortie"><input type="number" min={0} step={0.01} value={cur.out || ''} onChange={(e) => set({ out: Number(e.target.value) || 0 })} className={inputCls} /></Field>
      </div>
    </div>
  );
}
