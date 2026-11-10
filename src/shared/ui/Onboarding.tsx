import { Check, Copy, type LucideIcon, Share } from 'lucide-react';
import { m } from 'motion/react';
import type { ReactNode } from 'react';
import { usePreset } from '@/shared/lib/motion';
import { Button } from './Button';
import { cx } from './cx';

export interface WordmarkProps {
  /** «Cellier». */
  children: string;
  size?: 'display' | 'large-title' | undefined;
  className?: string | undefined;
}

/** «Cellier» in the display serif (04 §10). */
export function Wordmark({ children, size = 'display', className }: WordmarkProps) {
  return (
    <span className={cx(size === 'display' ? 'type-display' : 'type-large-title', 'text-label-primary', className)}>
      {children}
    </span>
  );
}

export interface OnboardingPageProps {
  /** Wordmark or a large glyph. */
  hero?: ReactNode | undefined;
  title: string;
  body?: ReactNode | undefined;
  primary?: { label: string; onPress: () => void; loading?: boolean | undefined } | undefined;
  secondary?: { label: string; onPress: () => void } | undefined;
  children?: ReactNode | undefined;
  /** Content enters with `smooth` (opacity, y 8 px), together: no stagger (02 §4.1). */
  animateIn?: boolean | undefined;
}

/** Full-screen onboarding step (04 §8): hero, serif title, one paragraph, primary button at the bottom. */
export function OnboardingPage({
  hero,
  title,
  body,
  primary,
  secondary,
  children,
  animateIn = true,
}: OnboardingPageProps) {
  const transition = usePreset('smooth');
  return (
    <div className="flex min-h-dvh flex-col px-6 pt-[calc(var(--safe-top)+48px)] pb-[calc(var(--safe-bottom)+16px)]">
      <m.div
        className="flex flex-1 flex-col items-center justify-center gap-4 text-center"
        initial={animateIn ? { opacity: 0, y: 8 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={transition}
      >
        {hero}
        <h1 className="type-title-1">{title}</h1>
        {body ? <p className="max-w-[320px] type-body text-label-secondary">{body}</p> : null}
        {children}
      </m.div>
      <div className="flex flex-col items-center gap-3">
        {primary ? (
          <Button fullWidth onClick={primary.onPress} loading={primary.loading}>
            {primary.label}
          </Button>
        ) : null}
        {secondary ? (
          <button
            type="button"
            onClick={secondary.onPress}
            className="min-h-11 px-2 type-body text-accent-fg outline-none focus-visible:focus-ring active:opacity-60"
          >
            {secondary.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export interface InstallStepProps {
  index: number;
  text: ReactNode;
  icon?: LucideIcon | undefined;
}

/** One numbered step of the install guide (04 §8), with the Safari glyph it refers to. */
export function InstallStep({ index, text, icon: Icon = Share }: InstallStepProps) {
  return (
    <li className="flex min-h-[52px] items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-tint type-badge text-accent-fg"
      >
        {index}
      </span>
      <span className="min-w-0 flex-1 type-body text-label-primary">{text}</span>
      <Icon size={20} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" className="shrink-0 text-accent-fg" />
    </li>
  );
}

export interface InviteCodeDisplayProps {
  code: string;
  /** Spoken form, e.g. characters separated by spaces. */
  accessibleLabel: string;
  copied: boolean;
  onCopy: () => void;
  copyLabel: string;
  copiedLabel: string;
  onShare?: (() => void) | undefined;
  shareLabel?: string | undefined;
}

/** 8-character invite code in rounded tabular numerals with copy and share; the copy feedback swaps with `snappy`. */
export function InviteCodeDisplay({
  code,
  accessibleLabel,
  copied,
  onCopy,
  copyLabel,
  copiedLabel,
  onShare,
  shareLabel,
}: InviteCodeDisplayProps) {
  const transition = usePreset('snappy');
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="rounded-md bg-fill-tertiary px-5 py-3 font-rounded text-[2rem] leading-none font-semibold tracking-[0.12em] tabular-nums">
        <span aria-hidden="true">{code}</span>
        <span className="sr-only">{accessibleLabel}</span>
      </p>
      <div className="flex gap-3">
        <Button variant="secondary" size="medium" onClick={onCopy} aria-live="polite">
          <m.span
            key={copied ? 'copied' : 'copy'}
            className="inline-flex items-center gap-2"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={transition}
          >
            {copied ? (
              <Check size={17} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" />
            ) : (
              <Copy size={17} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
            )}
            {copied ? copiedLabel : copyLabel}
          </m.span>
        </Button>
        {onShare && shareLabel ? (
          <Button variant="secondary" size="medium" icon={Share} onClick={onShare}>
            {shareLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export interface PermissionPrimerProps {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  allowLabel: string;
  onAllow: () => void;
  laterLabel: string;
  onLater: () => void;
}

/** Content of a primer sheet before a system prompt (04 §8): «Autoriser» triggers the prompt from this tap. */
export function PermissionPrimer({
  icon: Icon,
  title,
  body,
  allowLabel,
  onAllow,
  laterLabel,
  onLater,
}: PermissionPrimerProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-2 text-center">
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-full bg-accent-tint text-accent-fg"
      >
        <Icon size={28} strokeWidth={1.75} absoluteStrokeWidth />
      </span>
      <h2 className="type-title-3">{title}</h2>
      <p className="type-subhead text-label-secondary">{body}</p>
      <div className="mt-3 flex w-full flex-col gap-2">
        <Button fullWidth onClick={onAllow}>
          {allowLabel}
        </Button>
        <Button fullWidth variant="plain" onClick={onLater}>
          {laterLabel}
        </Button>
      </div>
    </div>
  );
}
