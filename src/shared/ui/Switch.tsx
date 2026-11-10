import { type ChangeEvent, useId } from 'react';
import { haptic } from '@/shared/lib/haptics';
import { cx } from './cx';

const nativeSwitch = typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype;

function setSwitchAttribute(el: HTMLInputElement | null) {
  el?.setAttribute('switch', '');
}

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible name when no `labelledBy` is given. */
  label?: string | undefined;
  /** Id of the element naming the switch (the row title in a toggle row). */
  labelledBy?: string | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  className?: string | undefined;
}

/**
 * On/off control (04 §6). A real `<input type="checkbox" switch>` on Safari 17.4+, which animates itself and plays the
 * platform haptic (site 3); elsewhere the same checkbox (role switch) drives a drawn track. Android gets a parity tick.
 */
export function Switch({ checked, onCheckedChange, label, labelledBy, disabled, id, className }: SwitchProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    haptic('switch');
    onCheckedChange(e.currentTarget.checked);
  };

  if (nativeSwitch) {
    return (
      <input
        ref={setSwitchAttribute}
        id={inputId}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        onChange={onChange}
        className={cx('shrink-0 accent-(--accent) outline-none focus-visible:focus-ring', className)}
      />
    );
  }

  return (
    <span className={cx('relative inline-flex h-[31px] w-[51px] shrink-0', className)}>
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        onChange={onChange}
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-full outline-none disabled:cursor-default"
      />
      <span
        aria-hidden="true"
        className={cx(
          'absolute inset-0 rounded-full border border-edge transition-colors duration-150 ease-out',
          'bg-fill-primary peer-checked:bg-accent peer-disabled:opacity-40',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus-ring',
        )}
      />
      <span
        aria-hidden="true"
        className={cx(
          'absolute top-[2px] left-[2px] size-[27px] rounded-full bg-stone-0 shadow-thumb',
          'transition-transform duration-200 ease-out peer-checked:translate-x-5',
        )}
      />
    </span>
  );
}
