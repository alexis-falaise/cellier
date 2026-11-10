export const fr = {
  app: {
    name: 'Cellier',
    tagline: 'Votre inventaire de cellier',
  },
  auth: {
    signingIn: 'Connexion en cours…',
  },
  pwa: {
    updateAvailable: 'Mise à jour disponible',
    reload: 'Recharger',
  },
  errors: {
    notFound: 'Page introuvable',
    generic: 'Une erreur est survenue',
  },
} as const;

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof fr>;

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let node: unknown = fr;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown>)[part];
  }
  const text = typeof node === 'string' ? node : key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
