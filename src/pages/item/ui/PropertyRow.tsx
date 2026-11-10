import type { ReactNode } from 'react';
import { cx, RowSeparator } from '@/shared/ui';

export interface PropertyRowProps {
  label: string;
  /** Null shows «—» in the tertiary colour. */
  value: ReactNode | null;
  /** `SourceCaption`: «Open Food Facts», «Saisi à la main», «Calculé». */
  caption?: string | null | undefined;
  /** Tabular digits (barcode, prices, counts). */
  numeric?: boolean | undefined;
  missing: string;
}

/** Item detail property (design 03 §4.6.7, 04 `PropertyRow`): label left, value right, source under it. */
export function PropertyRow({ label, value, caption, numeric = false, missing }: PropertyRowProps) {
  const empty = value === null || value === '';
  return (
    // biome-ignore lint/a11y/useSemanticElements: rows of an inset list rendered as divs, like ListRow
    <div role="listitem" className="relative flex min-h-[52px] items-center gap-3 px-4 py-3">
      <span className="shrink-0 type-body text-label-primary">{label}</span>
      <span className="flex min-w-0 flex-1 flex-col items-end text-right">
        <span className={cx('max-w-full truncate type-body', empty ? 'text-label-tertiary' : 'text-label-secondary')}>
          {empty ? missing : numeric ? <span className="font-rounded tabular-nums">{value}</span> : value}
        </span>
        {caption && !empty ? <span className="type-caption-1 text-label-tertiary">{caption}</span> : null}
      </span>
      <RowSeparator inset={16} />
    </div>
  );
}
