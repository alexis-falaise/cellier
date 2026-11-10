import type { FormEvent, ReactNode } from 'react';
import { goBack } from '@/app/navigation';
import { t } from '@/shared/i18n';
import { BackButton, Button, NavBar } from '@/shared/ui';

export interface OnboardingFormProps {
  title: string;
  body?: string | undefined;
  /** Grouped fields (`ListSection`s). */
  children: ReactNode;
  /** Error or offline line above the button, announced politely. */
  message?: string | null | undefined;
  submitLabel: string;
  canSubmit: boolean;
  busy: boolean;
  onSubmit: () => void;
  /** Title of the screen behind, for the back button. */
  backTitle: string;
}

/** Onboarding step with fields (design 03 §4.1.5–6): back, display-font title, grouped fields, one button. */
export function OnboardingForm({
  title,
  body,
  children,
  message,
  submitLabel,
  canSubmit,
  busy,
  onSubmit,
  backTitle,
}: OnboardingFormProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit && !busy) onSubmit();
  };
  return (
    <main className="flex min-h-dvh flex-col bg-bg-grouped pb-[calc(var(--safe-bottom)+16px)]">
      <NavBar
        leading={
          <BackButton
            previousTitle={backTitle}
            fallbackLabel={t('common.back')}
            accessibleLabel={t('common.back')}
            onPress={goBack}
          />
        }
      />
      <form className="flex flex-1 flex-col gap-6 pt-2" onSubmit={submit} noValidate>
        <div className="flex flex-col gap-2 px-6">
          <h1 className="type-title-1">{title}</h1>
          {body ? <p className="type-body text-label-secondary">{body}</p> : null}
        </div>
        {children}
        <div className="mt-auto flex flex-col gap-3 px-4">
          <p aria-live="polite" className="min-h-5 text-center type-footnote text-danger-fg">
            {message ?? ''}
          </p>
          <Button type="submit" fullWidth disabled={!canSubmit} loading={busy}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </main>
  );
}
