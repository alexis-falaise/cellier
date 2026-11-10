import { ChevronDown, ChevronLeft } from 'lucide-react';
import { type MotionValue, m, useScroll, useTransform } from 'motion/react';
import type { ReactNode, RefObject } from 'react';
import { cx } from './cx';
import { usePress } from './hooks/usePress';

const LARGE_TITLE_HEIGHT = 52;
const COMPACT_FADE = 12;
const MATERIAL_FADE = 8;

function useHeaderScroll(scrollRef: RefObject<HTMLElement | null> | undefined) {
  return useScroll(scrollRef ? { container: scrollRef as RefObject<HTMLElement> } : undefined).scrollY;
}

interface NavRowProps {
  leading?: ReactNode | undefined;
  center?: ReactNode | undefined;
  trailing?: ReactNode | undefined;
  materialOpacity: MotionValue<number>;
  centerOpacity?: MotionValue<number> | undefined;
}

function NavRow({ leading, center, trailing, materialOpacity, centerOpacity }: NavRowProps) {
  return (
    <div className="sticky top-0 z-(--z-sticky) pt-(--safe-top)">
      {/* The blur never animates: the already-blurred layer fades in (02 §7.3). */}
      <m.div
        aria-hidden="true"
        className="material absolute inset-0 border-b-(length:--hairline) border-separator-opaque"
        style={{ opacity: materialOpacity }}
      />
      <div className="relative grid h-(--nav-bar-height) grid-cols-[1fr_auto_1fr] items-center gap-2 pr-[calc(4px+var(--safe-right))] pl-[calc(4px+var(--safe-left))]">
        <div className="flex min-w-0 items-center justify-start">{leading}</div>
        <m.div
          className="min-w-0 max-w-[60vw] truncate text-center type-headline"
          style={centerOpacity ? { opacity: centerOpacity } : {}}
        >
          {center}
        </m.div>
        <div className="flex min-w-0 items-center justify-end">{trailing}</div>
      </div>
    </div>
  );
}

export interface LargeTitleHeaderProps {
  /** The page title; a string or a `PantrySwitcher`. Rendered as the page `<h1>` unless it is a node. */
  title: ReactNode;
  /** Text of the compact title shown once the large title scrolls away (defaults to `title` when a string). */
  compactTitle?: string | undefined;
  leading?: ReactNode | undefined;
  /** Up to two `IconButton`s, an `AvatarButton` or one text button. */
  trailing?: ReactNode | undefined;
  /** Line under the title, e.g. the `SyncIndicator`. */
  subtitle?: ReactNode | undefined;
  /** Optional `SearchField` under the title. */
  search?: ReactNode | undefined;
  /** Scroll container; the window when omitted. */
  scrollRef?: RefObject<HTMLElement | null> | undefined;
}

/**
 * iOS large title (04 §1, 02 §4.1): the 34 px serif title scrolls natively; the compact Headline title fades in over the
 * last 12 px and the bar material fades in over the first 8 px past the threshold. Scroll-linked, no spring.
 */
export function LargeTitleHeader({
  title,
  compactTitle,
  leading,
  trailing,
  subtitle,
  search,
  scrollRef,
}: LargeTitleHeaderProps) {
  const scrollY = useHeaderScroll(scrollRef);
  const compactOpacity = useTransform(scrollY, [LARGE_TITLE_HEIGHT - COMPACT_FADE, LARGE_TITLE_HEIGHT], [0, 1]);
  const materialOpacity = useTransform(scrollY, [LARGE_TITLE_HEIGHT, LARGE_TITLE_HEIGHT + MATERIAL_FADE], [0, 1]);
  const compact = compactTitle ?? (typeof title === 'string' ? title : undefined);
  return (
    <header>
      <NavRow
        leading={leading}
        trailing={trailing}
        center={compact ? <span aria-hidden="true">{compact}</span> : null}
        materialOpacity={materialOpacity}
        centerOpacity={compactOpacity}
      />
      <div className="flex h-(--large-title-height) items-end px-[calc(16px+var(--safe-left))] pb-[11px]">
        {typeof title === 'string' ? <h1 className="min-w-0 truncate type-large-title">{title}</h1> : title}
      </div>
      {subtitle}
      {search ? <div className="px-[calc(16px+var(--safe-left))] pt-2 pb-2">{search}</div> : null}
    </header>
  );
}

export interface NavBarProps {
  title?: string | undefined;
  /** Usually a `BackButton`. */
  leading?: ReactNode | undefined;
  trailing?: ReactNode | undefined;
  scrollRef?: RefObject<HTMLElement | null> | undefined;
}

/** Compact header of pushed screens (04 §1): back button, centred title, trailing slot; material once scrolled. */
export function NavBar({ title, leading, trailing, scrollRef }: NavBarProps) {
  const scrollY = useHeaderScroll(scrollRef);
  const materialOpacity = useTransform(scrollY, [0, MATERIAL_FADE], [0, 1]);
  return (
    <header>
      <NavRow
        leading={leading}
        trailing={trailing}
        center={title ? <h1 className="truncate type-headline">{title}</h1> : null}
        materialOpacity={materialOpacity}
      />
    </header>
  );
}

export interface BackButtonProps {
  /** Title of the previous screen. */
  previousTitle: string;
  /** «Retour»: shown instead of a previous title longer than 12 characters. */
  fallbackLabel: string;
  /** «Retour vers {titre}». */
  accessibleLabel: string;
  onPress: () => void;
}

/** Lucide `chevron-left` 22 px + previous title in Body, accent (03 §3.2). */
export function BackButton({ previousTitle, fallbackLabel, accessibleLabel, onPress }: BackButtonProps) {
  const { scale, handlers } = usePress(0.97);
  const text = previousTitle.length > 12 ? fallbackLabel : previousTitle;
  return (
    <m.button
      type="button"
      aria-label={accessibleLabel}
      onClick={onPress}
      {...handlers}
      style={{ scale }}
      className="flex min-h-11 min-w-11 items-center gap-0.5 rounded-sm pr-2 text-accent-fg outline-none focus-visible:focus-ring motion-reduce:data-pressed:opacity-60"
    >
      <ChevronLeft size={22} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" className="-translate-x-px" />
      <span className="truncate type-body">{text}</span>
    </m.button>
  );
}

export interface PantrySwitcherProps {
  name: string;
  /** False with a single cellier: plain title, no chevron. */
  interactive: boolean;
  onPress?: (() => void) | undefined;
  /** «Cellier : {name}». */
  accessibleLabel?: string | undefined;
  /** «Changer de cellier». */
  hint?: string | undefined;
}

/** The current cellier name as the large title, opening the pantry menu (03 §3.2). The chevron does not rotate (02). */
export function PantrySwitcher({ name, interactive, onPress, accessibleLabel, hint }: PantrySwitcherProps) {
  if (!interactive) return <h1 className="min-w-0 truncate type-large-title">{name}</h1>;
  return (
    <h1 className="flex min-w-0 type-large-title">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={accessibleLabel}
        aria-description={hint}
        onClick={onPress}
        className="flex min-w-0 items-baseline gap-1.5 rounded-sm text-left outline-none focus-visible:focus-ring active:opacity-60"
      >
        <span className="truncate">{name}</span>
        <ChevronDown
          size={20}
          strokeWidth={1.75}
          absoluteStrokeWidth
          aria-hidden="true"
          className="shrink-0 self-center text-label-secondary"
        />
      </button>
    </h1>
  );
}

export interface AvatarButtonProps {
  src?: string | null | undefined;
  initials: string;
  size?: 20 | 32 | 40 | undefined;
  /** Header variant: «Réglages». Without `onPress` the avatar is decorative. */
  label?: string | undefined;
  onPress?: (() => void) | undefined;
}

/** Google photo or initials on a neutral fill (04 §1); the 32 px header variant has a 44 × 44 hit area. */
export function AvatarButton({ src, initials, size = 32, label, onPress }: AvatarButtonProps) {
  const face = (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill-primary font-semibold text-label-secondary',
        size === 20 ? 'type-caption-2' : 'type-footnote',
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initials.slice(0, 2).toUpperCase()
      )}
    </span>
  );
  if (!onPress) return face;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className="inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:focus-ring active:opacity-60"
    >
      {face}
    </button>
  );
}
