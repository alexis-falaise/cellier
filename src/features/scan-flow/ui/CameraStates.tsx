import { CameraOff, type LucideIcon, ScanBarcode } from 'lucide-react';
import { m, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { t } from '@/shared/i18n';
import { presets } from '@/shared/lib/motion';
import { Button } from '@/shared/ui';

function Block({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <m.div
      className="absolute inset-0 flex flex-col items-center bg-scanner-bg px-8 pt-[30dvh] text-center text-stone-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: reduced ? presets.reduced : presets.smooth }}
    >
      <Icon size={40} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
      <h2 className="mt-5 type-title-2">{title}</h2>
      <p className="mt-2 max-w-[300px] type-subhead text-stone-0/70">{body}</p>
      <div className="mt-8 flex w-full max-w-[320px] flex-col gap-2">{children}</div>
    </m.div>
  );
}

/** Text button on the black cover (the shared plain button uses the accent text colour, too dark on black). */
export function DarkTextButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 rounded-sm px-4 type-headline text-green-300 outline-none focus-visible:focus-ring active:opacity-60"
    >
      {children}
    </button>
  );
}

/**
 * First-run camera primer on the black cover (03 §4.1.9). «Autoriser la caméra» calls getUserMedia from its own tap;
 * the dark scanner chrome replaces the shared light `PermissionPrimer` here.
 */
export function CameraPrimer({ onAllow, onManual }: { onAllow: () => void; onManual: () => void }) {
  return (
    <Block icon={ScanBarcode} title={t('scanner.primer.title')} body={t('scanner.primer.body')}>
      <Button fullWidth onClick={onAllow}>
        {t('scanner.primer.allow')}
      </Button>
      <DarkTextButton onClick={onManual}>{t('scanner.primer.manual')}</DarkTextButton>
    </Block>
  );
}

/** Permission denied, or no usable camera (03 §4.4.11). */
export function CameraProblem({
  denied,
  onRetry,
  onManual,
}: {
  denied: boolean;
  onRetry: () => void;
  onManual: () => void;
}) {
  return (
    <Block
      icon={CameraOff}
      title={denied ? t('scanner.denied.title') : t('scanner.unavailable.title')}
      body={denied ? t('scanner.denied.body') : t('scanner.unavailable.body')}
    >
      <Button fullWidth onClick={onRetry}>
        {t('common.retry')}
      </Button>
      <DarkTextButton onClick={onManual}>{t('scanner.manual')}</DarkTextButton>
    </Block>
  );
}
