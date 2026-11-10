/**
 * Google Identity Services, loaded on demand (research/17 §3.1, §8.2). Only the calls Cellier uses
 * are typed. The script origin is allowed by the CSP in vercel.json (`script-src`
 * https://accounts.google.com/gsi/client, `frame-src`/`connect-src` https://accounts.google.com/gsi/).
 */

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

export interface GisCredentialResponse {
  credential?: string;
  select_by?: string;
}

export interface GisIdConfiguration {
  client_id: string;
  callback: (response: GisCredentialResponse) => void;
  nonce?: string;
  ux_mode?: 'popup' | 'redirect';
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  itp_support?: boolean;
  use_fedcm_for_button?: boolean;
}

export interface GisButtonConfiguration {
  type: 'standard' | 'icon';
  theme: 'outline' | 'filled_blue' | 'filled_black';
  size: 'large' | 'medium' | 'small';
  text: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment: 'left' | 'center';
  width?: number;
  locale?: string;
}

export interface GisAccountsId {
  initialize(config: GisIdConfiguration): void;
  renderButton(parent: HTMLElement, options: GisButtonConfiguration): void;
  disableAutoSelect(): void;
}

interface GisWindow {
  google?: { accounts?: { id?: GisAccountsId } };
}

function gis(): GisAccountsId | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as GisWindow).google?.accounts?.id ?? null;
}

let loading: Promise<GisAccountsId> | null = null;

/** Injects the GIS script once; rejects on load error or after `timeoutMs`. */
export function loadGis(timeoutMs = 8000): Promise<GisAccountsId> {
  const ready = gis();
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<GisAccountsId>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    const timer = setTimeout(() => fail(new Error('GIS script timed out')), timeoutMs);
    function fail(error: Error) {
      clearTimeout(timer);
      loading = null;
      script.remove();
      reject(error);
    }
    script.onload = () => {
      clearTimeout(timer);
      const api = gis();
      if (api) resolve(api);
      else fail(new Error('GIS script loaded without google.accounts.id'));
    };
    script.onerror = () => fail(new Error('GIS script failed to load'));
    document.head.appendChild(script);
  });
  return loading;
}

/** After sign-out, so the next button does not pre-select the previous account. */
export function disableGoogleAutoSelect(): void {
  try {
    gis()?.disableAutoSelect();
  } catch {
    // GIS not loaded
  }
}
