import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { linkHost, safeUrlTransform } from '@/lib/markdown-safety';
import SafeMarkdown from '@/components/ui/SafeMarkdown';

/**
 * US-1 : neutralisation des images et liens du Markdown produit par le LLM.
 * Le composant réel SafeMarkdown est rendu côté serveur (HTML statique) : toute balise <img> ou tout attribut src/href
 * présent dans ce HTML déclencherait une requête dans le navigateur. Les vérifications « onglet Réseau » du Gherkin sont
 * donc établies sur le HTML produit (aucun <img>, aucun hôte distant en src) ; la preuve navigateur reste ⏳ (voir qa-report.md).
 */
const render = (text: string, variant: 'chat' | 'report' = 'chat') => renderToStaticMarkup(<SafeMarkdown text={text} variant={variant} />);
const MARKER = 'Image non affichée (protection des données)';

describe('safeUrlTransform', () => {
  it.each([
    ['https://exemple.fr/doc', 'https://exemple.fr/doc'],
    ['mailto:contact@exemple.fr', 'mailto:contact@exemple.fr'],
    ['#section', '#section'],
    ['  https://exemple.fr/doc  ', 'https://exemple.fr/doc'],
    ['HTTPS://EXEMPLE.FR/doc', 'https://exemple.fr/doc'],
  ])('conserve %j', (url, out) => { expect(safeUrlTransform(url, 'href')).toBe(out); });

  it.each([
    'http://exemple.fr/doc', 'javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<b>x</b>',
    '//example.com/x', 'vbscript:x', 'file:///etc/passwd', 'ftp://x', '', '   ', 'https://', 'https://exemple.fr/a b', 'https://exemple.fr/\u{2028}x',
    'https://exemple.fr/\u0085', '\u0000https://exemple.fr', 'relatif/page', '/chemin',
  ])('refuse %j', (url) => { expect(safeUrlTransform(url, 'href')).toBe(''); });

  it('vide toujours les src (images), même pour une URL https sûre', () => {
    expect(safeUrlTransform('https://example.com/x.png?d=secret', 'src')).toBe('');
    expect(safeUrlTransform('data:image/png;base64,AAAA', 'src')).toBe('');
    expect(safeUrlTransform('#a', 'src')).toBe('');
  });
});

describe('linkHost', () => {
  it('renvoie l’hôte (ou le domaine d’un mailto), vide si non analysable', () => {
    expect(linkHost('https://attaquant.tld/x?d=123')).toBe('attaquant.tld');
    expect(linkHost('mailto:contact@exemple.fr')).toBe('exemple.fr');
    expect(linkHost('#section')).toBe('');
    expect(linkHost('pas une url')).toBe('');
  });
});

describe('US-1 / SafeMarkdown : scénarios Gherkin (rendu HTML réel)', () => {
  it.each(['chat', 'report'] as const)('image Markdown (%s) : aucun <img>, aucun hôte distant, marqueur textuel avec le texte alternatif', (variant) => {
    const html = render('Voici ![graphique](https://example.com/x.png?d=secret) fin', variant);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain('example.com');
    expect(html).not.toContain('secret');
    expect(html).not.toMatch(/\ssrc=/i);
    expect(html).toContain(`${MARKER} : graphique`);
  });

  it('rapport : le marqueur remplace l’image (rendu destiné à l’export PDF, sans élément réseau)', () => {
    const html = render('![x](https://example.com/y.png)', 'report');
    expect(html).toContain(`${MARKER} : x`);
    expect(html).not.toMatch(/<img|example\.com/i);
  });

  it('image en syntaxe de référence ![a][r] + définition : neutralisée', () => {
    const html = render('![a][r]\n\n[r]: https://example.com/z.png');
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain('example.com');
    expect(html).toContain(MARKER);
  });

  it('image sans texte alternatif : marqueur sans suffixe', () => {
    const html = render('![](https://example.com/x.png)');
    expect(html).toContain(MARKER);
    expect(html).not.toMatch(/<img|example\.com/i);
  });

  it('texte alternatif très long : tronqué à 80 caractères', () => {
    const html = render(`![${'a'.repeat(200)}](https://example.com/x.png)`);
    expect(html).toContain(`: ${'a'.repeat(80)}`);
    expect(html).not.toContain('a'.repeat(81));
  });

  it('lien https : cliquable avec target, rel, referrerpolicy et info-bulle du domaine', () => {
    const html = render('[voir](https://exemple.fr/doc)');
    expect(html).toContain('href="https://exemple.fr/doc"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html.toLowerCase()).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('title="Lien externe vers exemple.fr"');
  });

  it('le domaine de destination est visible avant le clic : « Lien externe vers attaquant.tld »', () => {
    expect(render('[rapport](https://attaquant.tld/x?d=123)')).toContain('title="Lien externe vers attaquant.tld"');
  });

  it('mailto : cliquable ; ancre : cliquable sans target', () => {
    expect(render('[écrire](mailto:contact@exemple.fr)')).toContain('href="mailto:contact@exemple.fr"');
    const anchor = render('[haut](#section)');
    expect(anchor).toContain('href="#section"');
    expect(anchor).not.toContain('target=');
  });

  it.each([
    'http://exemple.fr/doc', 'javascript:alert(1)', 'data:text/html,<b>x</b>', '//example.com/x', 'JAVASCRIPT:alert(1)',
    'java&#9;script:alert(1)', '&#106;avascript:alert(1)', 'vbscript:x',
  ])('lien non sûr rendu en texte simple : %s', (url) => {
    const html = render(`[voir](<${url}>)`);
    expect(html).not.toMatch(/<a[\s>]/i);
    expect(html).not.toMatch(/href=/i);
    expect(html).toContain('voir');
  });

  it('lien automatique (autolink GFM) vers http:// : non cliquable', () => {
    const html = render('http://exemple.fr/doc et <http://exemple.fr/x>');
    expect(html).not.toMatch(/href="http:/i);
  });

  it('le HTML brut est ignoré : <img src=…> non interprété, aucune requête possible', () => {
    const html = render('<img src=https://example.com/a.png> texte <script>alert(1)</script> <iframe src="https://example.com"></iframe>');
    // Les balises sont affichées comme du texte échappé (&lt;img…) ; l'URL nue est reconnue par GFM comme un lien https cliquable (aucune requête automatique).
    expect(html).not.toMatch(/<img|<script|<iframe/i);
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/ssrc=/i);
    expect(html).not.toMatch(/<(img|script|iframe|link|source|video|audio|object|embed)[s>]/i);
  });

  it('image à l’intérieur d’un lien : ni <img>, ni requête ; le lien sûr reste cliquable', () => {
    const html = render('[![logo](https://example.com/l.png)](https://exemple.fr/)');
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain('example.com');
    expect(html).toContain('href="https://exemple.fr/"');
  });

  it('image dont l’URL est un data: : neutralisée aussi', () => {
    const html = render('![p](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)');
    expect(html).not.toMatch(/<img|data:image/i);
    expect(html).toContain(MARKER);
  });

  it('non-régression : le Markdown courant (titres, listes, tableaux GFM, code) reste rendu', () => {
    const html = render('# Titre\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```\n\n**gras**');
    expect(html).toContain('<h1>Titre</h1>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('<pre');
    expect(html).toContain('<strong>gras</strong>');
  });
});
