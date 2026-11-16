import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-12 / R1 : `authorize` est asynchrone. Un appel sans `await` rendrait `instanceof Response` toujours faux,
 * donc un contournement silencieux de l'authentification, sans erreur TypeScript. Ce test l'interdit statiquement.
 */
const ROOT = path.resolve(__dirname, '../..');
const API = path.join(ROOT, 'src/app/api');
const PUBLIC = new Set(['auth/login', 'auth/logout', 'auth/me', 'auth/setup']);
const HANDLER = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\([^)]*\)\s*\{/g;

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const rel = (f: string) => path.relative(API, path.dirname(f)).split(path.sep).join('/');
const routes = walk(API).filter((f) => path.basename(f) === 'route.ts');

/** Corps de chaque handler exporté (jusqu'à la prochaine déclaration de premier niveau). */
function handlers(src: string) {
  const starts = [...src.matchAll(HANDLER)];
  return starts.map((m, i) => ({ name: m[1], body: src.slice(m.index! + m[0].length, i + 1 < starts.length ? starts[i + 1].index : undefined) }));
}

describe('garde des routes API (R1)', () => {
  it('découvre les routes attendues', () => {
    expect(routes.length).toBeGreaterThanOrEqual(13);
  });

  for (const f of routes.filter((r) => !PUBLIC.has(rel(r)))) {
    it(`${rel(f)} : chaque handler commence par « await authorize( »`, () => {
      const src = fs.readFileSync(f, 'utf8');
      const hs = handlers(src);
      expect(hs.length).toBeGreaterThan(0);
      for (const h of hs) {
        const first = h.body.trim().split('\n')[0];
        expect(first, `${rel(f)} ${h.name}`).toMatch(/^const \w+ = await authorize\(req(, '(admin|user)')?\); if \(\w+ instanceof Response\) return \w+;/);
      }
    });
  }

  it('aucun appel à authorize sans await dans src/', () => {
    const offenders = walk(path.join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /(?<!await\s)(?<!function\s)\bauthorize\(/.test(fs.readFileSync(f, 'utf8').replace(/export async function authorize\(/g, '')));
    expect(offenders).toEqual([]);
  });

  it('plus aucune occurrence de requireAuth dans src/', () => {
    const offenders = walk(path.join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f) && fs.readFileSync(f, 'utf8').includes('requireAuth'));
    expect(offenders).toEqual([]);
  });
});
