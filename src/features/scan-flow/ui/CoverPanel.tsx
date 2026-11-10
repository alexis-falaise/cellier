import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { presets } from '@/shared/lib/motion';
import { cx } from '@/shared/ui';

export interface CoverPanelProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name when there is no visible title. */
  label: string;
  /** 56 px header (leading button, title, trailing button). */
  header?: ReactNode | undefined;
  /** `large`: top edge just under the status bar; `fit`: content height. */
  detent?: 'fit' | 'large' | undefined;
  children: ReactNode;
}

/**
 * A sheet that lives inside the scanner cover, as component state (03 §1.4: no URL change while the camera runs).
 * The shared `Sheet` is portalled below the cover's layer, so the scanner's overlays use this panel: scrim,
 * bottom panel rising with `sheet`, Escape and scrim tap close. Opaque elevated surface with the semantic
 * colours, so shared form controls keep their contrast.
 */
export function CoverPanel({ open, onClose, label, header, detent = 'fit', children }: CoverPanelProps) {
  const reduced = useReducedMotion();
  const t = reduced ? presets.reduced : presets.sheet;
  return (
    <AnimatePresence>
      {open ? (
        <PanelContent key="panel" onClose={onClose} label={label} header={header} detent={detent} transition={t}>
          {children}
        </PanelContent>
      ) : null}
    </AnimatePresence>
  );
}

function PanelContent({
  onClose,
  label,
  header,
  detent,
  transition,
  children,
}: Omit<CoverPanelProps, 'open'> & { transition: (typeof presets)[keyof typeof presets] }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>('[data-autofocus]') ?? el;
    target.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="absolute inset-0 z-30" data-cover-panel="">
      <m.div
        aria-hidden="true"
        className="absolute inset-0 bg-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition }}
        exit={{ opacity: 0, transition }}
        onClick={() => closeRef.current()}
      />
      <m.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-describedby={undefined}
        id={id}
        tabIndex={-1}
        className={cx(
          'absolute inset-x-0 bottom-0 mx-auto flex max-w-[600px] flex-col overflow-hidden rounded-t-xl bg-bg-elevated text-label-primary outline-none [color-scheme:normal]',
          detent === 'large' ? 'top-[calc(var(--safe-top)+10px)]' : 'max-h-[92%]',
        )}
        initial={reduced ? { opacity: 0 } : { y: '100%' }}
        animate={reduced ? { opacity: 1, transition } : { y: 0, transition }}
        exit={reduced ? { opacity: 0, transition } : { y: '100%', transition }}
      >
        <div aria-hidden="true" className="flex h-5 shrink-0 justify-center pt-1.5">
          <span className="h-[5px] w-9 rounded-full bg-label-tertiary opacity-50" />
        </div>
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(var(--safe-bottom)+16px)]">
          {children}
        </div>
      </m.div>
    </div>
  );
}
