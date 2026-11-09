import type { Row, TableSchema } from '../types';

/** PRNG déterministe pour des données démo stables. */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const pad = (n: number) => String(n).padStart(2, '0');
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export type Tables = Record<string, Row[]>;

/* ---------------------------------------------------------------- SALES DB */
export function buildSalesDb(): { tables: Tables; schema: TableSchema[] } {
  const r = rng(42);
  const countries = ['France', 'Allemagne', 'Espagne', 'Italie', 'Madagascar', 'Maurice'];
  const regions: Record<string, string> = { France: 'Europe', Allemagne: 'Europe', Espagne: 'Europe', Italie: 'Europe', Madagascar: 'Océan Indien', Maurice: 'Océan Indien' };
  const segments = ['Entreprise', 'PME', 'Particulier'];
  const customers: Row[] = Array.from({ length: 120 }, (_, i) => ({
    id: i + 1, name: `${pick(r, ['Alpha', 'Nova', 'Zenith', 'Orion', 'Vega', 'Delta', 'Lumen', 'Atlas', 'Pixel', 'Terra'])} ${pick(r, ['Corp', 'SARL', 'Group', 'Studio', 'Labs', 'Trading'])} ${i + 1}`,
    country: pick(r, countries), segment: pick(r, segments),
  }));
  customers.forEach((c) => (c.region = regions[c.country as string]));

  const cats: Record<string, [string, number, number][]> = {
    Logiciels: [['Licence Analytics Pro', 480, 90], ['Licence CRM Cloud', 360, 70], ['Suite Sécurité', 290, 80]],
    Matériel: [['Station de travail X1', 1450, 1050], ['Écran 4K 32"', 520, 390], ['Dock Thunderbolt', 210, 150], ['Casque Pro', 180, 95]],
    Services: [['Audit Data', 2400, 900], ['Formation BI (jour)', 1200, 500], ['Support Premium', 600, 220]],
    Accessoires: [['Clavier Mécanique', 130, 55], ['Souris Ergonomique', 95, 40], ['Webcam HD', 110, 60]],
  };
  const products: Row[] = [];
  let pid = 1;
  for (const [category, list] of Object.entries(cats)) for (const [name, price, cost] of list) products.push({ id: pid++, name, category, price, cost });

  const orders: Row[] = [];
  const items: Row[] = [];
  let oid = 1, iid = 1;
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 10) break;
      let n = 55 + Math.floor(r() * 20) + (y === 2026 ? 12 : 0);
      if (m === 11) n = Math.floor(n * 2.1);          // pic Black Friday (2025)
      if (y === 2026 && m === 3) n = Math.floor(n * 0.45); // rupture de stock mars 2026 -> anomalie
      if (m === 12) n = Math.floor(n * 1.25);
      for (let k = 0; k < n; k++) {
        const c = pick(r, customers);
        const day = 1 + Math.floor(r() * 28);
        const status = r() < 0.04 ? 'annulée' : r() < 0.08 ? 'en cours' : 'livrée';
        orders.push({ id: oid, customer_id: c.id, order_date: `${y}-${pad(m)}-${pad(day)}`, region: c.region, country: c.country, status });
        const lines = 1 + Math.floor(r() * 3);
        for (let l = 0; l < lines; l++) {
          const p = pick(r, products);
          const qty = 1 + Math.floor(r() * (p.category === 'Services' ? 3 : 6));
          const discount = r() < 0.25 ? pick(r, [0.05, 0.1, 0.15]) : 0;
          items.push({ id: iid++, order_id: oid, product_id: p.id, qty, unit_price: p.price, discount });
        }
        oid++;
      }
    }
  }
  const schema: TableSchema[] = [
    { name: 'customers', columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'text' }, { name: 'country', type: 'text' }, { name: 'segment', type: 'text' }, { name: 'region', type: 'text' }], rowCount: customers.length },
    { name: 'products', columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'text' }, { name: 'category', type: 'text' }, { name: 'price', type: 'number' }, { name: 'cost', type: 'number' }], rowCount: products.length },
    { name: 'orders', columns: [{ name: 'id', type: 'int' }, { name: 'customer_id', type: 'int', fk: 'customers.id' }, { name: 'order_date', type: 'date (YYYY-MM-DD texte)' }, { name: 'region', type: 'text' }, { name: 'country', type: 'text' }, { name: 'status', type: 'text (livrée|en cours|annulée)' }], rowCount: orders.length },
    { name: 'order_items', columns: [{ name: 'id', type: 'int' }, { name: 'order_id', type: 'int', fk: 'orders.id' }, { name: 'product_id', type: 'int', fk: 'products.id' }, { name: 'qty', type: 'int' }, { name: 'unit_price', type: 'number' }, { name: 'discount', type: 'number (0-1)' }], rowCount: items.length },
  ];
  return { tables: { customers, products, orders, order_items: items }, schema };
}

/* ---------------------------------------------------------------- ODOO MOCK */
export function buildOdooMock(): { tables: Tables; schema: TableSchema[] } {
  const r = rng(7);
  const reps = ['Hery Rakoto', 'Fanja Andria', 'Lova Razafy', 'Miora Ralay', 'Tojo Ravelo'];
  const partners: Row[] = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `${pick(r, ['Etech', 'Madagro', 'Tsiry', 'Indigo', 'Sakay', 'Baobab', 'Vanilla', 'Lemur'])} ${pick(r, ['SA', 'SARL', 'Export', 'Trading'])} ${i + 1}`, customer_rank: 1, supplier_rank: r() < 0.3 ? 1 : 0, country: pick(r, ['Madagascar', 'France', 'Maurice', 'La Réunion']) }));
  const prods: Row[] = ['Vanille Bourbon', 'Litchi surgelé', 'Huile essentielle Ylang', 'Cacao Criollo', 'Poivre sauvage', 'Girofle', 'Café Arabica', 'Rhum arrangé'].map((name, i) => ({ id: i + 1, name, list_price: [320, 45, 120, 28, 62, 35, 18, 24][i], standard_price: [210, 20, 70, 15, 33, 19, 9, 12][i], categ: i < 2 ? 'Épices & Fruits' : i < 5 ? 'Aromatiques' : 'Boissons & Cultures' }));
  const so: Row[] = [], sol: Row[] = [];
  let lid = 1;
  for (let i = 1; i <= 420; i++) {
    const m = 1 + Math.floor(r() * 10), d = 1 + Math.floor(r() * 28);
    const rep = pick(r, reps);
    const lines = 1 + Math.floor(r() * 3);
    let total = 0;
    for (let l = 0; l < lines; l++) {
      const p = pick(r, prods); const qty = 1 + Math.floor(r() * 40);
      const sub = round(qty * (p.list_price as number)); total += sub;
      sol.push({ id: lid++, order_id: i, product: p.name, qty, price_unit: p.list_price, price_subtotal: sub });
    }
    so.push({ id: i, name: `S${String(i).padStart(5, '0')}`, partner_id: pick(r, partners).id, user_id: rep, date_order: `2026-${pad(m)}-${pad(d)}`, amount_total: round(total * 1.2), state: pick(r, ['sale', 'sale', 'sale', 'done', 'draft', 'cancel']), team: rep.startsWith('H') || rep.startsWith('F') ? 'Export' : 'Local' });
  }
  const po: Row[] = Array.from({ length: 90 }, (_, i) => ({ id: i + 1, name: `P${String(i + 1).padStart(5, '0')}`, partner_id: pick(r, partners).id, date_order: `2026-${pad(1 + Math.floor(r() * 10))}-${pad(1 + Math.floor(r() * 28))}`, amount_total: round(800 + r() * 9000), state: pick(r, ['purchase', 'purchase', 'draft', 'done']) }));
  const inv: Row[] = Array.from({ length: 260 }, (_, i) => ({ id: i + 1, name: `INV/2026/${String(i + 1).padStart(4, '0')}`, move_type: r() < 0.85 ? 'out_invoice' : 'in_invoice', partner_id: pick(r, partners).id, invoice_date: `2026-${pad(1 + Math.floor(r() * 10))}-${pad(1 + Math.floor(r() * 28))}`, amount_total: round(300 + r() * 7000), payment_state: pick(r, ['paid', 'paid', 'paid', 'not_paid', 'partial']) }));
  // erreurs comptables injectées (anomalies)
  inv[40].name = inv[41].name;                       // numéro en doublon
  inv[88].amount_total = -4520.5;                    // facture client négative
  inv[120].partner_id = null as unknown as number;   // facture sans partenaire
  inv[200].amount_total = 98750;                     // montant aberrant
  const leads: Row[] = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, name: `Opportunité ${i + 1}`, stage: pick(r, ['Nouveau', 'Qualifié', 'Proposition', 'Gagné', 'Perdu']), expected_revenue: Math.round(2000 + r() * 40000), probability: pick(r, [10, 25, 50, 75, 100]), user_id: pick(r, reps) }));
  const quants: Row[] = prods.flatMap((p) => ['WH/Stock', 'WH/Export'].map((loc) => ({ product: p.name, location: loc, quantity: Math.floor(r() * 400), reserved: Math.floor(r() * 40) })));
  quants[3].quantity = -12; // stock négatif
  const schema: TableSchema[] = [
    { name: 'sale_order', description: 'Odoo sale.order — Ventes', columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'char' }, { name: 'partner_id', type: 'many2one', fk: 'res_partner.id' }, { name: 'user_id', type: 'commercial (texte)' }, { name: 'team', type: 'char' }, { name: 'date_order', type: 'date (YYYY-MM-DD texte)' }, { name: 'amount_total', type: 'monetary TTC' }, { name: 'state', type: 'draft|sale|done|cancel' }], rowCount: so.length },
    { name: 'sale_order_line', description: 'Odoo sale.order.line', columns: [{ name: 'id', type: 'int' }, { name: 'order_id', type: 'int', fk: 'sale_order.id' }, { name: 'product', type: 'char' }, { name: 'qty', type: 'float' }, { name: 'price_unit', type: 'float' }, { name: 'price_subtotal', type: 'monetary HT' }], rowCount: sol.length },
    { name: 'purchase_order', description: 'Odoo purchase.order — Achats', columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'char' }, { name: 'partner_id', type: 'many2one', fk: 'res_partner.id' }, { name: 'date_order', type: 'date' }, { name: 'amount_total', type: 'monetary' }, { name: 'state', type: 'char' }], rowCount: po.length },
    { name: 'account_move', description: 'Odoo account.move — Comptabilité', columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'char' }, { name: 'move_type', type: 'out_invoice|in_invoice' }, { name: 'partner_id', type: 'many2one', fk: 'res_partner.id' }, { name: 'invoice_date', type: 'date' }, { name: 'amount_total', type: 'monetary' }, { name: 'payment_state', type: 'paid|not_paid|partial' }], rowCount: inv.length },
    { name: 'crm_lead', description: 'Odoo crm.lead — CRM', columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'char' }, { name: 'stage', type: 'char' }, { name: 'expected_revenue', type: 'monetary' }, { name: 'probability', type: 'float' }, { name: 'user_id', type: 'commercial (texte)' }], rowCount: leads.length },
    { name: 'stock_quant', description: 'Odoo stock.quant — Stock', columns: [{ name: 'product', type: 'char' }, { name: 'location', type: 'char' }, { name: 'quantity', type: 'float' }, { name: 'reserved', type: 'float' }], rowCount: quants.length },
    { name: 'product_product', description: 'Odoo product.product', columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'char' }, { name: 'categ', type: 'char' }, { name: 'list_price', type: 'float' }, { name: 'standard_price', type: 'float' }], rowCount: prods.length },
    { name: 'res_partner', description: 'Odoo res.partner', columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'char' }, { name: 'country', type: 'char' }, { name: 'customer_rank', type: 'int' }, { name: 'supplier_rank', type: 'int' }], rowCount: partners.length },
  ];
  return { tables: { sale_order: so, sale_order_line: sol, purchase_order: po, account_move: inv, crm_lead: leads, stock_quant: quants, product_product: prods, res_partner: partners }, schema };
}

/* ------------------------------------------------------------- EXCEL DEMO */
export function buildExcelDemo(): { tables: Tables; schema: TableSchema[] } {
  const r = rng(99);
  const depts = ['Marketing', 'Ventes', 'R&D', 'Opérations', 'RH'];
  const budget: Row[] = [];
  for (let m = 1; m <= 10; m++) for (const d of depts) {
    const b = Math.round(20000 + depts.indexOf(d) * 6000 + r() * 4000);
    let a = Math.round(b * (0.88 + r() * 0.2));
    if (d === 'Marketing' && m === 8) a = Math.round(b * 1.65); // dépassement
    budget.push({ mois: `2026-${pad(m)}`, departement: d, budget: b, reel: a });
  }
  const headcount: Row[] = depts.map((d, i) => ({ departement: d, effectif: [8, 22, 15, 30, 5][i], cout_moyen: [4200, 3800, 5200, 3100, 4400][i] }));
  const schema: TableSchema[] = [
    { name: 'Budget', columns: [{ name: 'mois', type: 'texte YYYY-MM' }, { name: 'departement', type: 'texte' }, { name: 'budget', type: 'number' }, { name: 'reel', type: 'number' }], rowCount: budget.length },
    { name: 'Effectifs', columns: [{ name: 'departement', type: 'texte' }, { name: 'effectif', type: 'number' }, { name: 'cout_moyen', type: 'number' }], rowCount: headcount.length },
  ];
  return { tables: { Budget: budget, Effectifs: headcount }, schema };
}
