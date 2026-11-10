/**
 * Where the app runs, for the welcome and invite screens (design 03 §4.1.1): installed web app,
 * Safari tab on iOS (install path offered), another iOS browser (cannot install: copy the link),
 * or anything else (desktop, Android: sign in directly).
 */
export type InstallContext = 'standalone' | 'ios-safari' | 'ios-other' | 'other';

export interface InstallContextInput {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
}

const OTHER_IOS_BROWSERS = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo|FBAN|FBAV|Instagram|Line\//;

export function installContext({
  userAgent,
  platform,
  maxTouchPoints,
  standalone,
}: InstallContextInput): InstallContext {
  if (standalone) return 'standalone';
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (!ios) return 'other';
  return OTHER_IOS_BROWSERS.test(userAgent) ? 'ios-other' : 'ios-safari';
}

export function currentInstallContext(): InstallContext {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'other';
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
  return installContext({
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone,
  });
}
