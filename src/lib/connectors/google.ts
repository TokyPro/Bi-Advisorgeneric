/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Google Drive / Sheets — OAuth2 (Google Identity Services, flux token implicite côté navigateur)
 * + mode « clé API » pour les feuilles partagées publiquement.
 * L'utilisateur fournit son propre OAuth Client ID (BYOK) : créez-le sur console.cloud.google.com
 * (Application Web, origine JS autorisée = l'URL de l'app, API Drive + Sheets activées).
 */
import type { Row } from '../types';

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly';

export interface DriveFile { id: string; name: string; modifiedTime?: string; owners?: { displayName: string }[] }

function loadGis(): Promise<void> {
  return new Promise((res, rej) => {
    if ((window as any).google?.accounts?.oauth2) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => res();
    s.onerror = () => rej(new Error('Impossible de charger Google Identity Services (réseau bloqué ?).'));
    document.head.appendChild(s);
  });
}

export async function googleAuth(clientId: string): Promise<string> {
  if (!clientId) throw new Error('OAuth Client ID requis.');
  await loadGis();
  return new Promise((res, rej) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPES,
      callback: (r: any) => (r.error ? rej(new Error(r.error_description || r.error)) : res(r.access_token)),
      error_callback: (e: any) => rej(new Error(e?.message || 'Autorisation Google annulée.')),
    });
    client.requestAccessToken();
  });
}

async function gfetch(url: string, token?: string, apiKey?: string) {
  const u = apiKey ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}` : url;
  const res = await fetch(u, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const msg = j?.error?.message || res.statusText;
    if (res.status === 401) throw new Error('Session Google expirée : reconnectez-vous.');
    if (res.status === 403) throw new Error(`Accès refusé par Google : ${msg}`);
    if (res.status === 404) throw new Error('Feuille introuvable (ID incorrect ou non partagée).');
    throw new Error(`Google API ${res.status} : ${msg}`);
  }
  return res.json();
}

export async function listSheets(token: string, q = ''): Promise<DriveFile[]> {
  const query = [`mimeType='application/vnd.google-apps.spreadsheet'`, 'trashed=false', q ? `name contains '${q.replace(/'/g, "\\'")}'` : ''].filter(Boolean).join(' and ');
  const j = await gfetch(`https://www.googleapis.com/drive/v3/files?pageSize=50&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,owners(displayName))&q=${encodeURIComponent(query)}`, token);
  return j.files || [];
}

export const sheetIdFromUrl = (s: string) => s.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1] || s.trim();

export async function loadSpreadsheet(id: string, opts: { token?: string; apiKey?: string }): Promise<{ title: string; tables: Record<string, Row[]> }> {
  const meta = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties.title`, opts.token, opts.token ? undefined : opts.apiKey);
  const tables: Record<string, Row[]> = {};
  for (const sh of meta.sheets || []) {
    const title: string = sh.properties.title;
    const j = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(title)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, opts.token, opts.token ? undefined : opts.apiKey);
    const [head, ...body]: unknown[][] = j.values || [];
    if (!head || !body.length) continue;
    const keys = head.map((h, i) => String(h || `col${i + 1}`).trim().replace(/\s+/g, '_'));
    tables[title.replace(/[^\p{L}\p{N}]+/gu, '_')] = body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])));
  }
  if (!Object.keys(tables).length) throw new Error('Aucun onglet avec données.');
  return { title: meta.properties.title, tables };
}
