import { History, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { navigateTo, openConfirm, pushActivity, pushSheetPage, useOverlay } from '@/app/navigation';
import { leaveRemovedHousehold, useActiveHousehold, useSession } from '@/app/session';
import type { HouseholdId, InviteListItem } from '@/domain/types';
import { useHousehold, useIsOwner, useMembers } from '@/entities/member';
import { useOnline } from '@/features/auth';
import { formatDayLabel, formatDayMonth, t } from '@/shared/i18n';
import { useMutate } from '@/shared/sync';
import { ConfirmDialog, ListRow, ListSection, TextField } from '@/shared/ui';
import { withSettingsApi } from '../api';
import { inviteMemory } from '../model/invite';
import { registeredSettingsPage } from '../registry';
import { Avatar, closeConfirmAndWait, closeSheetAndWait, PageLayout, RowIcon, showFailure } from './common';

const LEAVE = 'household-leave';
const DELETE = 'household-delete';
const REVOKE = 'invite-revoke';

/** Pending invitations of the household (owner only, online only). */
function usePendingInvites(householdId: HouseholdId | null, enabled: boolean) {
  const [items, setItems] = useState<InviteListItem[]>([]);
  const reload = useCallback(async () => {
    if (!householdId || !enabled) {
      setItems([]);
      return;
    }
    const result = await withSettingsApi((api) => api.listPendingInvites(householdId));
    if (result.ok) setItems(result.value);
  }, [householdId, enabled]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, reload };
}

/** Name of the household: editable by the owner (saved on blur through `household.rename`). */
function HouseholdName({ name, editable }: { name: string; editable: boolean }) {
  const mutate = useMutate();
  const [draft, setDraft] = useState(name);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(name);
  }, [name, focused]);

  if (!editable) {
    return <ListRow variant="plain" title={t('onboarding.create.householdLabel')} value={name} />;
  }
  const save = () => {
    setFocused(false);
    const next = draft.trim();
    if (!next) {
      setDraft(name);
      return;
    }
    if (next !== name) mutate('household.rename', { name: next });
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus and blur bubble from the field's input
    <div onFocus={() => setFocused(true)} onBlur={save}>
      <TextField
        label={t('onboarding.create.householdLabel')}
        value={draft}
        onChange={setDraft}
        maxLength={60}
        enterKeyHint="done"
        error={focused && draft.trim() === '' ? t('onboarding.create.householdRequired') : undefined}
      />
    </div>
  );
}

/** Foyer (03 §4.12.1): name, members, invitations, activity, leave or delete. */
export function HouseholdPage() {
  const { user } = useSession();
  const active = useActiveHousehold();
  const household = useHousehold();
  const members = useMembers();
  const isOwner = useIsOwner();
  const online = useOnline();
  const overlay = useOverlay();
  const pending = usePendingInvites(active.id, isOwner && online);
  const [revoking, setRevoking] = useState<InviteListItem | null>(null);
  const [busy, setBusy] = useState(false);

  const name = household?.name ?? active.name ?? '';
  const others = members.filter((m) => m.userId !== user?.id);
  const ownerAlone = isOwner && others.length === 0;

  const leaveOrDelete = async (kind: 'leave' | 'delete') => {
    const id = active.id;
    if (!id) return;
    setBusy(true);
    await closeConfirmAndWait();
    const result = await withSettingsApi((api) =>
      kind === 'leave' ? api.leaveHousehold(id) : api.deleteHousehold(id),
    );
    if (!result.ok) {
      setBusy(false);
      showFailure(result.reason);
      return;
    }
    // Closes the household on this device and deletes its local data, then back to onboarding.
    await leaveRemovedHousehold();
    navigateTo('/onboarding/household', { replace: true });
  };

  const revoke = async () => {
    const invite = revoking;
    await closeConfirmAndWait();
    if (!invite) return;
    const result = await withSettingsApi((api) => api.revokeInvite(invite.id));
    if (!result.ok) {
      showFailure(result.reason);
      return;
    }
    inviteMemory.forget(invite.id);
    await pending.reload();
  };

  const offlineFooter = online ? undefined : t('settings.offline');

  return (
    <PageLayout page="household">
      <ListSection label={t('household.title')}>
        <HouseholdName name={name} editable={isOwner} />
      </ListSection>

      <ListSection header={t('household.members')} footer={isOwner ? undefined : t('household.memberFooter')}>
        {members.map((m) => {
          const self = m.userId === user?.id;
          const role = t(m.role === 'owner' ? 'role.owner' : 'role.member');
          return (
            <ListRow
              key={m.userId}
              variant={isOwner && !self ? 'navigation' : 'plain'}
              leading={<Avatar src={m.avatarUrl} name={m.displayName} size={40} />}
              leadingWidth={40}
              title={m.displayName || t('role.member')}
              subtitle={self ? `${role} · ${t('common.you')}` : role}
              onPress={isOwner && !self ? () => pushSheetPage({ page: 'member', id: m.userId }) : undefined}
            />
          );
        })}
        {isOwner ? (
          <ListRow
            variant="button"
            leading={<RowIcon icon={UserPlus} tone="accent" />}
            title={t('household.invite')}
            onPress={() => pushSheetPage({ page: 'invite' })}
          />
        ) : null}
      </ListSection>

      {isOwner && pending.items.length > 0 ? (
        <ListSection header={t('household.pending')}>
          {pending.items.map((invite) => (
            <ListRow
              key={invite.id}
              variant="plain"
              title={t('invite.pendingRow', { date: formatDayMonth(new Date(invite.createdAt)) })}
              subtitle={t('invite.expires', { date: formatDayLabel(new Date(invite.expiresAt)) })}
              trailing={
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => {
                    setRevoking(invite);
                    openConfirm(REVOKE);
                  }}
                  className="relative min-h-11 shrink-0 rounded-sm px-2 type-body text-danger-fg outline-none focus-visible:focus-ring active:opacity-60 disabled:text-label-tertiary"
                >
                  {t('invite.revoke')}
                </button>
              }
            />
          ))}
        </ListSection>
      ) : null}

      <ListSection label={t('household.activity')}>
        <ListRow
          leading={<RowIcon icon={History} />}
          title={t('household.activity')}
          onPress={() => {
            if (registeredSettingsPage('activity')) pushSheetPage({ page: 'activity' });
            else void closeSheetAndWait().then(pushActivity);
          }}
        />
      </ListSection>

      <ListSection
        label={t('household.leave')}
        footer={isOwner && !ownerAlone ? t('household.leave.ownerBlocked') : offlineFooter}
      >
        {isOwner && !ownerAlone ? <ListRow variant="destructive" title={t('household.leave')} disabled /> : null}
        {isOwner ? (
          <ListRow
            variant="destructive"
            title={t('household.delete')}
            disabled={busy || !online}
            onPress={() => openConfirm(DELETE)}
          />
        ) : (
          <ListRow
            variant="destructive"
            title={t('household.leave')}
            disabled={busy || !online}
            onPress={() => openConfirm(LEAVE)}
          />
        )}
      </ListSection>

      <ConfirmDialog
        open={overlay.confirm === LEAVE}
        onOpenChange={(open) => !open && void closeConfirmAndWait()}
        title={t('household.leave.title', { household: name })}
        message={t('household.leave.message')}
        actions={[{ label: t('household.leave'), destructive: true, onPress: () => void leaveOrDelete('leave') }]}
        cancelLabel={t('common.cancel')}
      />
      <ConfirmDialog
        open={overlay.confirm === DELETE}
        onOpenChange={(open) => !open && void closeConfirmAndWait()}
        title={t('household.delete.title', { household: name })}
        message={t('household.delete.message')}
        actions={[{ label: t('household.delete'), destructive: true, onPress: () => void leaveOrDelete('delete') }]}
        cancelLabel={t('common.cancel')}
      />
      <ConfirmDialog
        open={overlay.confirm === REVOKE}
        onOpenChange={(open) => !open && void closeConfirmAndWait()}
        title={t('invite.revoke.title')}
        message={t('invite.revoke.message')}
        actions={[{ label: t('invite.revoke'), destructive: true, onPress: () => void revoke() }]}
        cancelLabel={t('common.cancel')}
      />
    </PageLayout>
  );
}
