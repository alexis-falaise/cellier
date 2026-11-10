import type { LucideIcon } from 'lucide-react';
import { m } from 'motion/react';
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { cx } from './cx';
import { usePress } from './hooks/usePress';
import { Spinner } from './Spinner';

type NativeButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  | 'style'
  | 'onAnimationStart'
  | 'onAnimationEnd'
  | 'onDrag'
  | 'onDragStart'
  | 'onDragEnd'
  | 'onPointerDown'
  | 'onPointerMove'
  | 'onPointerUp'
  | 'onPointerCancel'
  | 'onPointerLeave'
  | 'onClickCapture'
>;

export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive' | 'destructive-plain';
export type ButtonSize = 'large' | 'medium' | 'small';

export interface ButtonProps extends NativeButtonProps {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  fullWidth?: boolean | undefined;
  /** Capsule shape (empty-state actions); otherwise radius 14 (large) or 10. */
  pill?: boolean | undefined;
  loading?: boolean | undefined;
  /** Accessible label while loading, e.g. «Chargement». */
  loadingLabel?: string | undefined;
  icon?: LucideIcon | undefined;
  children?: ReactNode | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent shadow-none motion-reduce:data-pressed:bg-accent-pressed disabled:bg-accent',
  secondary: 'bg-fill-secondary text-accent-fg motion-reduce:data-pressed:bg-fill-primary',
  plain: 'bg-transparent text-accent-fg motion-reduce:data-pressed:opacity-60',
  destructive: 'bg-danger text-on-accent motion-reduce:data-pressed:bg-danger-pressed',
  'destructive-plain': 'bg-transparent text-danger-fg motion-reduce:data-pressed:opacity-60',
};

const SIZE: Record<ButtonSize, string> = {
  large: 'min-h-[50px] px-5 type-headline rounded-md',
  medium: 'min-h-11 px-4 type-headline rounded-sm',
  small: 'min-h-9 px-3 type-subhead font-semibold rounded-sm hit-44',
};

/** Text button (04 §6): press scale 0.97 on pointer-down, action on click. */
export function Button({
  variant = 'primary',
  size = 'large',
  fullWidth = false,
  pill = false,
  loading = false,
  loadingLabel,
  icon: Icon,
  disabled,
  className,
  children,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  const inactive = disabled || loading;
  const { scale, handlers } = usePress(0.97, inactive);
  return (
    <m.button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      {...rest}
      aria-label={loading && loadingLabel ? loadingLabel : rest['aria-label']}
      {...handlers}
      style={{ scale }}
      className={cx(
        'relative inline-flex select-none items-center justify-center gap-2 border border-edge',
        'transition-[background-color,color,opacity] duration-150 ease-out data-pressed:transition-none',
        'touch-manipulation focus-visible:focus-ring outline-none disabled:opacity-40',
        variant === 'plain' || variant === 'destructive-plain' ? 'border-transparent' : '',
        VARIANT[variant],
        SIZE[size],
        pill && 'rounded-full',
        fullWidth && 'w-full',
        loading && 'pointer-events-none',
        className,
      )}
    >
      <span className={cx('inline-flex items-center gap-2', loading && 'invisible')}>
        {Icon ? <Icon size={20} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" /> : null}
        {children}
      </span>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={17} />
        </span>
      ) : null}
    </m.button>
  );
}

export interface IconButtonProps extends NativeButtonProps {
  icon: LucideIcon;
  /** Required accessible name (icon-only control). */
  label: string;
  /** Glyph size: 22 in nav bars (default), 20 in toolbars, 17 inline. */
  iconSize?: number | undefined;
  tone?: 'accent' | 'secondary' | 'primary' | 'danger' | 'on-dark' | undefined;
  /** Visible circle behind the glyph (stepper, close on sheets). */
  filled?: boolean | undefined;
  /** Visible diameter when filled. */
  visualSize?: number | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

const TONE: Record<NonNullable<IconButtonProps['tone']>, string> = {
  accent: 'text-accent-fg',
  secondary: 'text-label-secondary',
  primary: 'text-label-primary',
  danger: 'text-danger-fg',
  'on-dark': 'text-stone-0',
};

/** Icon-only button: 44 × 44 hit area, press scale 0.92; under reduced motion the glyph dims instead. */
export function IconButton({
  icon: Icon,
  label,
  iconSize = 22,
  tone = 'accent',
  filled = false,
  visualSize = 32,
  disabled,
  className,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  const { scale, handlers } = usePress(0.92, disabled);
  return (
    <m.button
      ref={ref}
      type={type}
      aria-label={label}
      disabled={disabled}
      {...rest}
      {...handlers}
      style={{ scale }}
      className={cx(
        'group relative inline-flex size-11 shrink-0 select-none items-center justify-center rounded-full',
        'touch-manipulation outline-none focus-visible:focus-ring disabled:opacity-40',
        TONE[tone],
        className,
      )}
    >
      {filled ? (
        <span
          aria-hidden="true"
          className="absolute rounded-full border border-edge bg-fill-secondary"
          style={{ width: visualSize, height: visualSize }}
        />
      ) : null}
      <Icon
        size={iconSize}
        strokeWidth={iconSize >= 24 ? 1.75 : 1.5}
        absoluteStrokeWidth
        aria-hidden="true"
        className="relative transition-opacity duration-150 ease-out motion-reduce:group-data-pressed:opacity-60 motion-reduce:group-data-pressed:transition-none"
      />
    </m.button>
  );
}
