import type { DataSource } from '../types';
import { sleep } from '../utils';

/**
 * "Demo Advisor" : moteur d'intentions local pour tester l'application sans clé API.
 * Il génère de vrais blocs bi-query exécutés sur les données de démo (ou, à défaut, sur n'importe quel fichier).
 */
const block = (o: object) => '```bi-query\n' + JSON.stringify(o) + '\n```';
const follow = (a: string, b: string) => `\n\n**Pour aller plus loin**\n- ${a}\n- ${b}`;
const NET = `SUM(i.qty*i.unit_price*(1-i.discount))`;

type Handler = { re: RegExp; kinds: string[]; run: (s: DataSource) => string };

const handlers: Handler[] = [
  {
    re: /(évolution|evolution|tendance|trend|mensuel|par mois|month).*(ca|chiffre|revenu|vente|sales)|(ca|chiffre d'affaires|revenu).*(mois|mensuel|évolution)|anomal|pic|baisse|chute/i, kinds: ['demo-sales'],
    run: (s) => `Je mesure le **chiffre d'affaires net mensuel** (hors commandes annulées, remises déduites) pour repérer tendances et ruptures.\n\n${block({ source: s.id, type: 'sql', sql: `SELECT SUBSTRING(o.order_date,1,7) AS mois, ROUND(${NET},0) AS ca FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status <> 'annulée' GROUP BY SUBSTRING(o.order_date,1,7) ORDER BY mois`, viz: { type: 'area', x: 'mois', y: ['ca'], title: 'CA net mensuel', format: 'currency' } })}\n\nLe détecteur d'anomalies analyse automatiquement la courbe : regardez les pastilles sur le graphique (pic de fin d'année, creux inhabituel au printemps 2026).${follow('Quelle catégorie explique le creux de mars 2026 ?', 'Quelle est la marge par catégorie ?')}`,
  },
  {
    re: /marge|margin|rentab|profit/i, kinds: ['demo-sales'],
    run: (s) => `Je calcule la **marge brute par catégorie** (prix net après remise − coût d'achat).\n\n${block({ source: s.id, type: 'sql', sql: `SELECT p.category AS categorie, ROUND(SUM(i.qty*(i.unit_price*(1-i.discount)-p.cost)),0) AS marge, ROUND(100*SUM(i.qty*(i.unit_price*(1-i.discount)-p.cost))/SUM(i.qty*i.unit_price*(1-i.discount)),1) AS taux_marge FROM order_items i JOIN products p ON p.id=i.product_id JOIN orders o ON o.id=i.order_id WHERE o.status <> 'annulée' GROUP BY p.category ORDER BY marge DESC`, viz: { type: 'bar', x: 'categorie', y: ['marge'], title: 'Marge brute par catégorie', format: 'currency' } })}\n\nLes **services** et **logiciels** ont typiquement un taux de marge bien supérieur au matériel : c'est le levier à privilégier.${follow('Quels produits ont le meilleur taux de marge ?', 'Comment évolue la marge mois par mois ?')}`,
  },
  {
    re: /produit|product|top|meilleur|best/i, kinds: ['demo-sales'],
    run: (s) => `Voici le **top 8 des produits** par chiffre d'affaires net.\n\n${block({ source: s.id, type: 'sql', sql: `SELECT p.name AS produit, ROUND(${NET},0) AS ca FROM order_items i JOIN products p ON p.id=i.product_id JOIN orders o ON o.id=i.order_id WHERE o.status <> 'annulée' GROUP BY p.name ORDER BY ca DESC LIMIT 8`, viz: { type: 'bar', x: 'produit', y: ['ca'], title: 'Top 8 produits par CA', format: 'currency' } })}${follow('Quelle part du CA représentent ces 8 produits ?', 'Quels clients achètent le plus ces produits ?')}`,
  },
  {
    re: /client|customer|segment|pivot|croisé|croise/i, kinds: ['demo-sales'],
    run: (s) => `Tableau croisé **segment × région** du CA net.\n\n${block({ source: s.id, type: 'sql', sql: `SELECT c.segment AS segment, o.region AS region, ROUND(${NET},0) AS ca FROM order_items i JOIN orders o ON o.id=i.order_id JOIN customers c ON c.id=o.customer_id WHERE o.status <> 'annulée' GROUP BY c.segment, o.region`, viz: { type: 'pivot', x: 'segment', series: 'region', y: ['ca'], title: 'CA — segment × région', format: 'currency' } })}\n\nEt les **10 meilleurs clients** :\n\n${block({ source: s.id, type: 'sql', sql: `SELECT c.name AS client, c.country AS pays, ROUND(${NET},0) AS ca FROM order_items i JOIN orders o ON o.id=i.order_id JOIN customers c ON c.id=o.customer_id WHERE o.status <> 'annulée' GROUP BY c.name, c.country ORDER BY ca DESC LIMIT 10`, viz: { type: 'table', title: 'Top 10 clients', format: 'currency' } })}${follow('Quelle est la concentration du CA sur les 10 premiers clients ?', 'Quels clients ont cessé de commander ?')}`,
  },
  {
    re: /région|region|pays|country|géograph|répartition/i, kinds: ['demo-sales'],
    run: (s) => `Répartition du **CA par pays**.\n\n${block({ source: s.id, type: 'sql', sql: `SELECT o.country AS pays, ROUND(${NET},0) AS ca FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status <> 'annulée' GROUP BY o.country ORDER BY ca DESC`, viz: { type: 'pie', x: 'pays', y: ['ca'], title: 'CA par pays', format: 'currency' } })}${follow('Quel est le panier moyen par pays ?', 'La croissance 2026 vs 2025 par région ?')}`,
  },
  {
    re: /kpi|synthèse|synthese|résumé|resume|overview|vue d'ensemble|indicateur|panier/i, kinds: ['demo-sales'],
    run: (s) => `Les **indicateurs clés** de votre activité :\n\n${block({ source: s.id, type: 'sql', sql: `SELECT ROUND(${NET},0) AS ca_total FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status <> 'annulée'`, viz: { type: 'kpi', y: ['ca_total'], title: 'CA net total', format: 'currency' } })}\n\n${block({ source: s.id, type: 'sql', sql: `SELECT COUNT(*) AS commandes FROM orders WHERE status <> 'annulée'`, viz: { type: 'kpi', y: ['commandes'], title: 'Commandes valides', format: 'number' } })}\n\n${block({ source: s.id, type: 'sql', sql: `SELECT ROUND(100.0*SUM(CASE WHEN status='annulée' THEN 1 ELSE 0 END)/COUNT(*),1) AS taux FROM orders`, viz: { type: 'kpi', y: ['taux'], title: "Taux d'annulation (%)", format: 'number' } })}${follow('Comment évolue le CA mensuel ?', 'Quelles catégories dégagent la meilleure marge ?')}`,
  },
  // ---------------- Odoo mock
  {
    re: /comptab|facture|invoice|erreur|doublon|anomal|account/i, kinds: ['demo-odoo'],
    run: (s) => `Contrôle de cohérence **comptable** : numéros en doublon, montants négatifs/aberrants et pièces sans partenaire.\n\n${block({ source: s.id, type: 'sql', sql: `SELECT name AS piece, COUNT(*) AS occurrences FROM account_move GROUP BY name HAVING COUNT(*) > 1`, viz: { type: 'table', title: 'Numéros de pièces en doublon' } })}\n\n${block({ source: s.id, type: 'sql', sql: `SELECT name AS piece, move_type AS type, amount_total AS montant, partner_id FROM account_move WHERE amount_total < 0 OR amount_total > 50000 OR partner_id IS NULL`, viz: { type: 'table', title: 'Pièces suspectes (négatif, aberrant, sans partenaire)', format: 'currency' } })}\n\n⚠️ Ces pièces doivent être vérifiées avant clôture.${follow('Quel est le montant total impayé ?', 'Quels clients ont le plus de factures en retard ?')}`,
  },
  {
    re: /commercial|vendeur|sales ?rep|équipe|ventes?|chiffre|ca\b/i, kinds: ['demo-odoo'],
    run: (s) => `**Ventes confirmées par commercial** (commandes en état « sale » ou « done »).\n\n${block({ source: s.id, type: 'sql', sql: `SELECT user_id AS commercial, ROUND(SUM(amount_total),0) AS ca FROM sale_order WHERE state IN ('sale','done') GROUP BY user_id ORDER BY ca DESC`, viz: { type: 'bar', x: 'commercial', y: ['ca'], title: 'CA par commercial', format: 'currency' } })}\n\n${block({ source: s.id, type: 'sql', sql: `SELECT SUBSTRING(date_order,1,7) AS mois, ROUND(SUM(amount_total),0) AS ca FROM sale_order WHERE state IN ('sale','done') GROUP BY SUBSTRING(date_order,1,7) ORDER BY mois`, viz: { type: 'line', x: 'mois', y: ['ca'], title: 'CA mensuel (Odoo)', format: 'currency' } })}${follow('Quel est le pipeline CRM pondéré ?', 'Quels produits se vendent le mieux ?')}`,
  },
  {
    re: /crm|pipeline|opportunit|lead/i, kinds: ['demo-odoo'],
    run: (s) => `**Pipeline CRM** par étape (revenu attendu).\n\n${block({ source: s.id, type: 'sql', sql: `SELECT stage AS etape, ROUND(SUM(expected_revenue),0) AS revenu_attendu, ROUND(SUM(expected_revenue*probability/100),0) AS revenu_pondere FROM crm_lead GROUP BY stage ORDER BY revenu_attendu DESC`, viz: { type: 'bar', x: 'etape', y: ['revenu_attendu', 'revenu_pondere'], title: 'Pipeline par étape', format: 'currency' } })}${follow('Quel commercial a le meilleur taux de conversion ?', 'Quelle est la valeur des opportunités perdues ?')}`,
  },
  {
    re: /stock|inventaire|quant|entrepôt/i, kinds: ['demo-odoo'],
    run: (s) => `**Niveaux de stock** par produit.\n\n${block({ source: s.id, type: 'sql', sql: `SELECT product AS produit, SUM(quantity) AS quantite FROM stock_quant GROUP BY product ORDER BY quantite DESC`, viz: { type: 'bar', x: 'produit', y: ['quantite'], title: 'Stock par produit' } })}\n\nUne quantité **négative** signale une erreur d'inventaire (ou une sortie non enregistrée) à corriger.${follow('Quels produits sont en rupture imminente ?', 'Quelle est la rotation des stocks ?')}`,
  },
  // ---------------- Excel demo
  {
    re: /budget|réel|reel|écart|ecart|dépass|depass|département|departement|effectif/i, kinds: ['demo-excel'],
    run: (s) => `**Budget vs réel** par département.\n\n${block({ source: s.id, type: 'sql', sql: `SELECT departement, SUM(budget) AS budget, SUM(reel) AS reel FROM Budget GROUP BY departement ORDER BY reel DESC`, viz: { type: 'bar', x: 'departement', y: ['budget', 'reel'], title: 'Budget vs réel par département', format: 'currency' } })}\n\n${block({ source: s.id, type: 'sql', sql: `SELECT mois, ROUND(100.0*(reel-budget)/budget,1) AS ecart_pct FROM Budget WHERE departement='Marketing' ORDER BY mois`, viz: { type: 'line', x: 'mois', y: ['ecart_pct'], title: 'Marketing — écart au budget (%)' } })}\n\nLe département **Marketing** présente un dépassement ponctuel marqué (voir l'alerte sur la courbe).${follow('Quel est le coût salarial par département ?', 'Quel département dérive le plus ?')}`,
  },
];

export function demoRespond(question: string, sources: DataSource[]): string {
  const active = sources.filter((s) => s.enabled && s.engine === 'local');
  const q = question.trim();
  for (const h of handlers) {
    if (!h.re.test(q)) continue;
    const src = active.find((s) => h.kinds.includes(s.kind));
    if (src) return h.run(src);
  }
  // fallback : prochaine intention possible sur une source de démo, sinon analyse générique
  const generic = active.find((s) => s.schema.length);
  if (generic && /^(demo-)/.test(generic.kind)) {
    const h = handlers.find((x) => x.kinds.includes(generic.kind))!;
    return `Je n'ai pas de requête dédiée à cette formulation dans le mode démo, mais voici une analyse pertinente sur **${generic.name}** :\n\n${h.run(generic)}\n\n_Astuce : connectez votre clé LLM (⚙️) pour poser n'importe quelle question en langage naturel._`;
  }
  if (generic) {
    const t = generic.schema.find((x) => x.columns.some((c) => c.type === 'int' || c.type === 'number'));
    if (t) {
      const num = t.columns.find((c) => c.type === 'int' || c.type === 'number')!;
      const cat = t.columns.find((c) => c.type === 'text') || t.columns[0];
      return `Analyse exploratoire automatique de **${t.name}** : somme de \`${num.name}\` par \`${cat.name}\`.\n\n${block({ source: generic.id, type: 'sql', sql: `SELECT \`${cat.name}\` AS categorie, ROUND(SUM(\`${num.name}\`),2) AS total FROM \`${t.name}\` GROUP BY \`${cat.name}\` ORDER BY total DESC LIMIT 15`, viz: { type: 'bar', x: 'categorie', y: ['total'], title: `${num.name} par ${cat.name}` } })}\n\n_Mode démo : configurez un LLM (⚙️) pour des analyses en langage naturel sur vos données._`;
    }
  }
  return `Je n'ai pas de source de données interrogeable active. Connectez une source (➕ dans la barre latérale) ou activez les **données de démonstration**.\n\n_Mode démo : configurez un LLM (⚙️) pour des analyses libres._`;
}

export async function* demoStream(text: string, signal?: AbortSignal): AsyncGenerator<string> {
  await sleep(350);
  for (let i = 0; i < text.length; i += 14) {
    if (signal?.aborted) return;
    yield text.slice(i, i + 14);
    await sleep(10);
  }
}

/** Questions d'Auto-EDA sans LLM (heuristique + jeux démo). */
export function heuristicInsights(s: DataSource): string[] {
  if (s.kind === 'demo-sales') return ["Quelle est l'évolution mensuelle du chiffre d'affaires et où sont les anomalies ?", 'Quelle est la marge par catégorie de produits ?', 'Quels sont les 8 meilleurs produits par CA ?', 'Quelle est la répartition du CA par pays ?', 'Donne-moi les KPI de synthèse'];
  if (s.kind === 'demo-odoo') return ['Quel est le CA par commercial et son évolution mensuelle ?', 'Quelles erreurs comptables dois-je corriger (doublons, négatifs) ?', 'Quel est le pipeline CRM par étape ?', 'Comment se présente le stock par produit ?'];
  if (s.kind === 'demo-excel') return ['Compare le budget et le réel par département', "Où y a-t-il eu un dépassement de budget anormal ?"];
  const out: string[] = [];
  for (const t of s.schema.slice(0, 2)) {
    const num = t.columns.find((c) => c.type === 'int' || c.type === 'number');
    const cat = t.columns.find((c) => c.type === 'text');
    const date = t.columns.find((c) => c.type.startsWith('date') || /date|mois|month/i.test(c.name));
    if (num && cat) out.push(`Quelle est la répartition de ${num.name} par ${cat.name} dans ${t.name} ?`);
    if (num && date) out.push(`Comment évolue ${num.name} dans le temps (${date.name}) et y a-t-il des anomalies ?`);
    out.push(`Quelles sont les valeurs manquantes ou aberrantes dans ${t.name} ?`);
  }
  return out.slice(0, 5);
}
