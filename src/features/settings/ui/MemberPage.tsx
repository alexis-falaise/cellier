import { useState } from 'react';
import { openConfirm, popSheetPage, useOverlay } from '@/app/navigation';
import { syncNow, useActiveHousehold } from '@/app/session';
import type { UserId } from '@/domain/types';
import { useIsOwner, useMember } from '@/entities/member';
import { useOnline } from '@/features/auth';
import { formatDayMonth, t } from '@/shared/i18n';
import { ConfirmDialog, ListRow, ListSection } from '@/shared/ui';
import { withSettingsApi } from '../api';
import { closeConfirmAndWait, IdentityBlock, PageLayout, showFailure } from './common';

const MAKE_OWNER = 'member-owner';
const REMOVE = 'member-remove';

/** Membre (03 §4.12.2, owner only): make owner, remove from the household. */
export function MemberPage({ userId }: { userId: string }) {
  const live = useMember(userId);
  // Keep the last known row while the page pops after a removal.
  const [member, setMember] = useState(live);
  if (live && live !== member) setMember(live);
  const household = useActiveHousehold();
  const isOwner = useIsOwner();
  const online = useOnline();
  const overlay = useOverlay();
  const [busy, setBusy] = useState(false);

  if (!member) return <PageLayout page="member">{null}</PageLayout>;
  const name = member.displayName || t('role.member');

  const run = async (kind: 'owner' | 'remove') => {
    const householdId = household.id;
    if (!householdId) return;
    setBusy(true);
    await closeConfirmAndWait();
    const result = await withSettingsApi((api) =>
      kind === 'owner'
        ? api.transferOwnership(householdId, member.userId as UserId)
        : api.removeMember(householdId, member.userId as UserId),
    );
    setBusy(false);
    if (!result.ok) {
      showFailure(result.reason);
      return;
    }
    // The member list and roles arrive with the next pull.
    void syncNow();
    popSheetPage();
  };

  const canAct = isOwner && member.role !== 'owner';

  return (
    <PageLayout page="member" title={name}>
      <IdentityBlock
        avatarUrl={member.avatarUrl}
        name={name}
        lines={[t('member.since', { date: formatDayMonth(new Date(member.joinedAt)) })]}
      />
      {canAct ? (
        <ListSection label={name} footer={online ? undefined : t('settings.offline')}>
          <ListRow
            variant="button"
            title={t('member.makeOwner')}
            disabled={busy || !online}
            onPress={() => openConfirm(MAKE_OWNER)}
          />
          <ListRow
            variant="destructive"
            title={t('member.remove')}
            disabled={busy || !online}
            onPress={() => openConfirm(REMOVE)}
          />
        </ListSection>
      ) : null}

      <ConfirmDialog
        open={overlay.confirm === MAKE_OWNER}
        onOpenChange={(open) => !open && void closeConfirmAndWait()}
        title={t('member.makeOwner.title', { name })}
        message={t('member.makeOwner.message', { name })}
        actions={[{ label: t('member.makeOwner'), onPress: () => void run('owner') }]}
        cancelLabel={t('common.cancel')}
      />
      <ConfirmDialog
        open={overlay.confirm === REMOVE}
        onOpenChange={(open) => !open && void closeConfirmAndWait()}
        title={t('member.remove.title', { name })}
        message={t('member.remove.message', { name })}
        actions={[{ label: t('member.remove.confirm'), destructive: true, onPress: () => void run('remove') }]}
        cancelLabel={t('common.cancel')}
      />
    </PageLayout>
  );
}
