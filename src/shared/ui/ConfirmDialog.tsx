import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from '@/shared/lib/haptics';
import { presets } from '@/shared/lib/motion';
import { cx } from './cx';
import { useModalFocus } from './hooks/useModalFocus';

export interface ConfirmAction {
  label: string;
  onPress: () => void;
  destructive?: boolean | undefined;
}

export interface ConfirmDialogProps {
  open: boolean;
  /** Called with false on cancel, Escape or a scrim tap. */
  onOpenChange: (open: boolean) => void;
  title?: string | undefined;
  message?: string | undefined;
  /** One or more actions; a destructive one plays haptic site 4 when tapped. */
  actions: ConfirmAction[];
  /** «Annuler». */
  cancelLabel: string;
}

/**
 * The only blocking confirmation (03 §3.7, 04 §6): iOS action-sheet style, a group of 56 px buttons with an optional
 * title and message, a separate «Annuler» below. Opens with `sheet`, closes with `smooth`; the background dims.
 */
export function ConfirmDialog({ open, onOpenChange, title, message, actions, cancelLabel }: ConfirmDialogProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <ConfirmContent
          key="confirm"
          onOpenChange={onOpenChange}
          title={title}
          message={message}
          actions={actions}
          cancelLabel={cancelLabel}
        />
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function ConfirmContent({ onOpenChange, title, message, actions, cancelLabel }: Omit<ConfirmDialogProps, 'open'>) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  const cancel = () => onOpenChange(false);
  useModalFocus(ref, true, cancel);
  const offscreen = typeof window === 'undefined' ? 800 : window.innerHeight;
  const enter = reduced ? presets.reduced : presets.sheet;
  const exit = reduced ? presets.reduced : presets.smooth;

  return (
    <>
      <m.div
        aria-hidden="true"
        className="fixed inset-0 z-(--z-menu) bg-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: enter }}
        exit={{ opacity: 0, transition: exit }}
        onClick={cancel}
      />
      <m.div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-(--z-menu) mx-auto flex max-w-[600px] flex-col gap-2 px-4 pb-[calc(var(--safe-bottom)+8px)] outline-none"
        initial={reduced ? { opacity: 0 } : { y: offscreen }}
        animate={reduced ? { opacity: 1, transition: enter } : { y: 0, transition: enter }}
        exit={reduced ? { opacity: 0, transition: exit } : { y: offscreen, transition: exit }}
      >
        <div className="overflow-hidden rounded-md border border-edge bg-surface-elevated shadow-menu">
          {title || message ? (
            <div className="flex flex-col gap-1 px-4 py-3.5 text-center">
              {title ? (
                <h2 id={titleId} className="type-footnote font-semibold text-label-secondary">
                  {title}
                </h2>
              ) : null}
              {message ? (
                <p id={messageId} className="type-footnote text-label-secondary">
                  {message}
                </p>
              ) : null}
            </div>
          ) : null}
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                if (action.destructive) haptic('destructive');
                action.onPress();
              }}
              className={cx(
                'relative flex h-14 w-full items-center justify-center type-body outline-none focus-visible:focus-ring focus-visible:-outline-offset-2',
                'before:absolute before:inset-x-0 before:top-0 before:h-(--hairline) before:bg-separator',
                'transition-[background-color] duration-150 ease-out active:bg-fill-quaternary active:transition-none',
                action.destructive ? 'text-danger-fg' : 'text-accent-fg',
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-autofocus=""
          onClick={cancel}
          className={cx(
            'h-14 w-full rounded-md border border-edge bg-surface-elevated type-headline text-accent-fg shadow-menu outline-none',
            'transition-[background-color] duration-150 ease-out focus-visible:focus-ring active:bg-fill-quaternary active:transition-none',
          )}
        >
          {cancelLabel}
        </button>
      </m.div>
    </>
  );
}
