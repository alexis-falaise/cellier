import { Check, ChevronRight, type LucideIcon } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { cx } from './cx';
import { useRowHighlight } from './hooks/useRowHighlight';
import { useElevatedSurface } from './surface';

export interface ListSectionProps {
  header?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  /** Accessible name when there is no visible header. */
  label?: string | undefined;
}

/** iOS inset grouped section (04 §2): sentence-case footnote header, radius 14 surface, inset separators. */
export function ListSection({ header, footer, children, className, label }: ListSectionProps) {
  const id = useId();
  const elevated = useElevatedSurface();
  return (
    <section
      aria-labelledby={header ? id : undefined}
      aria-label={header ? undefined : label}
      className={cx('mx-4', className)}
    >
      {header ? <SectionHeader id={id}>{header}</SectionHeader> : null}
      {/* biome-ignore lint/a11y/useSemanticElements: children are wrapped rows (SwipeActions), not direct li elements */}
      <div
        role="list"
        className={cx(
          'overflow-hidden rounded-md border border-edge',
          elevated ? 'bg-surface-elevated' : 'bg-surface',
          '[&>*:last-child_[data-separator]]:hidden',
        )}
      >
        {children}
      </div>
      {footer ? <SectionFooter>{footer}</SectionFooter> : null}
    </section>
  );
}

export function SectionHeader({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <h2 id={id} className={cx('mb-2 px-4 type-footnote text-label-secondary', className)}>
      {children}
    </h2>
  );
}

export function SectionFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('mt-2 px-4 type-footnote text-label-secondary', className)}>{children}</p>;
}

/** Hairline separator inset from the leading edge; hidden under the last row of a section. */
export function RowSeparator({ inset }: { inset: number }) {
  return (
    <span
      data-separator=""
      aria-hidden="true"
      className="pointer-events-none absolute right-0 bottom-0 h-(--hairline) bg-separator"
      style={{ left: inset }}
    />
  );
}

export type ListRowVariant = 'navigation' | 'value' | 'toggle' | 'destructive' | 'button' | 'plain';

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode | undefined;
  variant?: ListRowVariant | undefined;
  /** Leading 28 px tile, icon or avatar. */
  leading?: ReactNode | undefined;
  /** Width of the leading element, for the separator inset (default 28 when `leading` is set). */
  leadingWidth?: number | undefined;
  /** Trailing value text (value / navigation rows). */
  value?: ReactNode | undefined;
  /** Custom trailing control (toggle rows: a `Switch` labelled by the title). */
  trailing?: ReactNode | undefined;
  /** Glyph for button and destructive rows. */
  icon?: LucideIcon | undefined;
  onPress?: (() => void) | undefined;
  href?: string | undefined;
  selected?: boolean | undefined;
  disabled?: boolean | undefined;
  /** 80 ms highlight delay inside scroll containers (default true). */
  inScrollContainer?: boolean | undefined;
  className?: string | undefined;
  'aria-label'?: string | undefined;
}

/**
 * Generic settings / navigation row (04 §2): minimum 52 px, no scale, highlight on pointer-down that fades over
 * 150 ms. Navigation rows render a link when `href` is given; toggle rows are a plain row whose control is the switch.
 */
export function ListRow({
  title,
  subtitle,
  variant = 'navigation',
  leading,
  leadingWidth,
  value,
  trailing,
  icon: Icon,
  onPress,
  href,
  selected,
  disabled = false,
  inScrollContainer = true,
  className,
  'aria-label': ariaLabel,
}: ListRowProps) {
  const interactive = variant !== 'toggle' && variant !== 'plain' && (onPress !== undefined || href !== undefined);
  const highlight = useRowHighlight(inScrollContainer, disabled || !interactive);
  const inset = leading ? 16 + (leadingWidth ?? 28) + 12 : 16;

  const titleClass =
    variant === 'destructive'
      ? 'text-danger-fg'
      : variant === 'button'
        ? 'text-accent-fg'
        : disabled
          ? 'text-label-quaternary'
          : 'text-label-primary';

  const content = (
    <>
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col py-2">
        <span className={cx('type-body', titleClass, 'flex items-center gap-2')}>
          {Icon ? <Icon size={20} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" /> : null}
          <span className="min-w-0 truncate">{title}</span>
        </span>
        {subtitle ? <span className="type-subhead text-label-secondary">{subtitle}</span> : null}
      </span>
      {value !== undefined ? (
        <span className="max-w-[50%] shrink-0 truncate type-body text-label-secondary">{value}</span>
      ) : null}
      {trailing}
      {selected ? (
        <Check size={20} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" className="shrink-0 text-accent-fg" />
      ) : null}
      {variant === 'navigation' && interactive ? (
        <ChevronRight
          size={17}
          strokeWidth={1.5}
          absoluteStrokeWidth
          aria-hidden="true"
          className="-mr-1 shrink-0 translate-x-px text-label-tertiary"
        />
      ) : null}
      <RowSeparator inset={inset} />
    </>
  );

  const base = cx(
    'relative flex min-h-[52px] w-full items-center gap-3 px-4 text-left',
    'transition-[background-color] duration-150 ease-out data-pressed:bg-fill-quaternary data-pressed:transition-none',
    'outline-none focus-visible:focus-ring focus-visible:-outline-offset-2',
    className,
  );

  if (!interactive) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: rows sit inside SwipeActions wrappers, so a native li would not be a direct child of the list
      <div role="listitem" className={base} aria-label={ariaLabel}>
        {content}
      </div>
    );
  }

  if (href !== undefined && !disabled) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: rows sit inside SwipeActions wrappers, so a native li would not be a direct child of the list
      <div role="listitem">
        <a
          href={href}
          className={base}
          aria-label={ariaLabel}
          aria-current={selected ? 'true' : undefined}
          onClick={
            onPress
              ? (e) => {
                  e.preventDefault();
                  onPress();
                }
              : undefined
          }
          {...highlight}
        >
          {content}
        </a>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: rows sit inside SwipeActions wrappers, so a native li would not be a direct child of the list
    <div role="listitem">
      <button
        type="button"
        className={cx(base, 'disabled:cursor-default')}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={selected === undefined ? undefined : selected}
        onClick={onPress}
        {...highlight}
      >
        {content}
      </button>
    </div>
  );
}
