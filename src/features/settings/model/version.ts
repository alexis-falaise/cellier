/**
 * «Cellier {version} ({build})» (03 §4.10). The build does not inject a version yet, so these read
 * optional `VITE_APP_VERSION` / `VITE_APP_BUILD` variables and fall back to the package version
 * and the Vite mode.
 */
const env = import.meta.env as Record<string, unknown>;

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

export const APP_VERSION = text(env.VITE_APP_VERSION, '0.0.0');
export const APP_BUILD = text(env.VITE_APP_BUILD, text(env.MODE, 'web')).slice(0, 12);
