import crypto from 'node:crypto';

/** Paramètres scrypt inchangés depuis la v1 : les hachages existants de data/users.json restent valides. */
const PARAMS: crypto.ScryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Version asynchrone (pool libuv) : ne bloque pas la boucle d'événements partagée par plusieurs requêtes.
const scrypt = (pw: string, salt: string) => new Promise<Buffer>((resolve, reject) =>
  crypto.scrypt(pw, salt, 64, PARAMS, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(pw: string, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: (await scrypt(pw, salt)).toString('hex') };
}

export async function checkPassword(u: { hash: string; salt: string } | undefined, pw: string): Promise<boolean> {
  // calcul factice si l'utilisateur n'existe pas : temps de réponse constant
  const h = await scrypt(pw, u?.salt ?? 'f'.repeat(32));
  const ref = Buffer.from(u?.hash ?? '0'.repeat(128), 'hex');
  return !!u && h.length === ref.length && crypto.timingSafeEqual(h, ref);
}

export function validatePassword(pw: string) {
  if (pw.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Le mot de passe doit contenir des lettres et des chiffres.';
  return null;
}
