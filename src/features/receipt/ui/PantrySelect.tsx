import { ChevronsUpDown } from 'lucide-react';
import type { Pantry, PantryId } from '@/domain/types';
import { cx } from '@/shared/ui';

export interface PantrySelectProps {
  pantries: readonly Pantry[];
  value: PantryId | null;
  onChange: (pantryId: PantryId) => void;
  label: string;
  /** Shown when `value` is null (mixed selection). */
  placeholder?: string | undefined;
  className?: string | undefined;
}

/**
 * Cellier chip backed by a native `<select>`: on iPhone it opens the system wheel, which is the
 * fastest way to pick one of a few celliers per receipt line.
 */
export function PantrySelect({ pantries, value, onChange, label, placeholder, className }: PantrySelectProps) {
  return (
    <span className={cx('relative inline-flex min-w-0 max-w-full items-center', className)}>
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value as PantryId);
        }}
        className="h-8 min-w-0 max-w-full appearance-none truncate rounded-full bg-fill-secondary py-0 pr-8 pl-3 type-subhead font-medium text-label-primary outline-none focus-visible:focus-ring"
      >
        {value === null ? (
          <option value="" disabled>
            {placeholder ?? ''}
          </option>
        ) : null}
        {pantries.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <ChevronsUpDown
        aria-hidden="true"
        size={14}
        strokeWidth={2}
        className="pointer-events-none absolute right-3 text-label-secondary"
      />
    </span>
  );
}
