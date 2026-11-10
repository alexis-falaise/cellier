import { type ReactNode, useEffect } from 'react';
import { closeConfirm } from '@/app/navigation';
import { SheetHeader, useScreenScrollRef } from '@/shared/ui';

/**
 * One page of a large sheet with pushes (ItemEditSheet, NewItemSheet and their category step): a
 * sticky `SheetHeader` over inset grouped sections. The scroll view is marked as the sheet's
 * scroller so a downward drag hands off to the sheet only at the top.
 */
export function SheetPage({
  title,
  leading,
  trailing,
  children,
}: {
  title: string;
  leading?: ReactNode | undefined;
  trailing?: ReactNode | undefined;
  children: ReactNode;
}) {
  const scrollRef = useScreenScrollRef();
  useEffect(() => {
    scrollRef?.current?.setAttribute('data-sheet-scroll', '');
  }, [scrollRef]);
  return (
    <div className="flex min-h-full flex-col bg-bg-elevated">
      <div className="sticky top-0 z-10 bg-bg-elevated">
        <SheetHeader title={title} leading={leading} trailing={trailing} />
      </div>
      <div className="flex flex-col gap-8 pt-2 pb-[calc(var(--safe-bottom)+24px)]">{children}</div>
    </div>
  );
}

/** Runs a history step and resolves once it has landed (before the next navigation). */
export function stepAndWait(step: () => void): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('popstate', finish);
      resolve();
    };
    window.addEventListener('popstate', finish);
    step();
    window.setTimeout(finish, 400);
  });
}

export function closeConfirmAndWait(): Promise<void> {
  return stepAndWait(closeConfirm);
}
