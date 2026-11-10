/**
 * Toast queue (design 03 §2.6): one toast at a time, queued; held back while the scanner cover is
 * open (the tray owns feedback there). The shell renders the current toast with `Toast`.
 *
 *   showToast({ message: t('toast.itemDeleted'), action: { label: t('common.undo'), onPress } });
 */
import type { LucideIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { ToastData } from '@/shared/ui';

export interface ToastInput {
  message: string;
  icon?: LucideIcon | undefined;
  action?: { label: string; onPress: () => void } | undefined;
  /** Replaces a queued or visible toast with the same key instead of queueing another. */
  key?: string | undefined;
}

let counter = 0;
let current: ToastData | null = null;
let queue: Array<ToastData & { key?: string | undefined }> = [];
let held = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of [...listeners]) l();
}

function advance() {
  if (current || held) return;
  current = queue.shift() ?? null;
  if (current) emit();
}

export function showToast(input: ToastInput): string {
  counter += 1;
  const toast = {
    id: `toast-${counter}`,
    message: input.message,
    icon: input.icon,
    action: input.action,
    key: input.key,
  };
  if (input.key) queue = queue.filter((q) => q.key !== input.key);
  if (input.key && (current as { key?: string } | null)?.key === input.key) {
    current = toast;
    emit();
    return toast.id;
  }
  queue.push(toast);
  advance();
  return toast.id;
}

export function dismissToast(id: string): void {
  queue = queue.filter((q) => q.id !== id);
  if (current?.id === id) {
    current = null;
    emit();
    advance();
  }
}

/** The shell holds toasts while the scanner is open. */
export function holdToasts(hold: boolean): void {
  if (held === hold) return;
  held = hold;
  if (hold && current) {
    queue.unshift(current);
    current = null;
    emit();
  }
  advance();
}

const getCurrent = () => current;

export function useCurrentToast(): ToastData | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getCurrent,
    getCurrent,
  );
}
