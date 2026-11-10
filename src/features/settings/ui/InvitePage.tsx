import { CircleAlert, CloudOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveHousehold } from '@/app/session';
import { showToast } from '@/app/toasts';
import type { CreateInviteResult, HouseholdId } from '@/domain/types';
import { formatInviteCode, spellInviteCode, useOnline } from '@/features/auth';
import { formatShortDate, t } from '@/shared/i18n';
import { Button, DelayedSpinner, EmptyState, InviteCodeDisplay } from '@/shared/ui';
import { withSettingsApi } from '../api';
import { inviteMemory, inviteUrl, reusableInvite } from '../model/invite';
import { PageLayout } from './common';

type InviteState =
  | { kind: 'loading' }
  | { kind: 'ready'; invite: CreateInviteResult }
  | { kind: 'offline' }
  | { kind: 'error' };

/** The code shown last time if still pending, otherwise a new one (online only). */
async function obtainInvite(householdId: HouseholdId): Promise<InviteState> {
  const cached = inviteMemory.get(householdId);
  if (cached) {
    const pending = await withSettingsApi((api) => api.listPendingInvites(householdId));
    const reuse = pending.ok ? reusableInvite(cached, pending.value, Date.now()) : null;
    if (reuse) return { kind: 'ready', invite: reuse };
  }
  const created = await withSettingsApi((api) => api.createInvite(householdId));
  if (!created.ok) return { kind: created.reason === 'offline' ? 'offline' : 'error' };
  inviteMemory.set(householdId, created.value);
  return { kind: 'ready', invite: created.value };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Inviter un membre (03 §4.12.3, owner only): creates a code on open; share as a link or copy the code. */
export function InvitePage() {
  const household = useActiveHousehold();
  const online = useOnline();
  const [state, setState] = useState<InviteState>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    if (!household.id) return;
    if (!online) {
      setState({ kind: 'offline' });
      return;
    }
    setState({ kind: 'loading' });
    setState(await obtainInvite(household.id));
  }, [household.id, online]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  if (state.kind !== 'ready') {
    return (
      <PageLayout page="invite">
        {state.kind === 'loading' ? (
          <div className="flex justify-center pt-16">
            <DelayedSpinner active label={t('household.invite')} />
          </div>
        ) : (
          <EmptyState
            className="mt-12"
            icon={state.kind === 'offline' ? CloudOff : CircleAlert}
            title={state.kind === 'offline' ? t('invite.offline') : t('invite.error')}
            action={{ label: t('common.retry'), onPress: () => void load() }}
          />
        )}
      </PageLayout>
    );
  }

  const { code, expiresAt } = state.invite;
  const url = inviteUrl(window.location.origin, code);
  const display = formatInviteCode(code);

  const copyCode = async () => {
    if (!(await copyText(display))) return;
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    showToast({ message: t('toast.codeCopied'), key: 'invite-copy' });
  };

  const share = async () => {
    const text = t('invite.shareText', { household: household.name ?? t('household.title'), url, code: display });
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
        return;
      } catch (error) {
        // Cancelled by the user: nothing to do. Any other failure falls back to copying the link.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    if (await copyText(url)) showToast({ message: t('toast.linkCopied'), key: 'invite-copy' });
  };

  return (
    <PageLayout page="invite">
      <p className="px-8 text-center type-body text-label-secondary text-pretty">{t('invite.body')}</p>
      <div className="flex flex-col items-center gap-3 px-4">
        <InviteCodeDisplay
          code={display}
          accessibleLabel={t('a11y.invite.code', { code: spellInviteCode(code) })}
          copied={copied}
          onCopy={() => void copyCode()}
          copyLabel={t('invite.copyCode')}
          copiedLabel={t('invite.copied')}
        />
        <p className="type-footnote text-label-secondary">
          {t('invite.expiresOn', { date: formatShortDate(new Date(expiresAt)) })}
        </p>
      </div>
      <div className="px-4">
        <Button fullWidth onClick={() => void share()}>
          {t('invite.share')}
        </Button>
      </div>
    </PageLayout>
  );
}
