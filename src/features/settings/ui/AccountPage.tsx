import { useState } from 'react';
import { openConfirm, useOverlay } from '@/app/navigation';
import { signOut, useActiveHousehold, useSession } from '@/app/session';
import { useMembers } from '@/entities/member';
import { useSyncSummary } from '@/entities/sync';
import { useOnline } from '@/features/auth';
import { t } from '@/shared/i18n';
import { ConfirmDialog, ListRow, ListSection } from '@/shared/ui';
import { withSettingsApi } from '../api';
import { accountDeletion } from '../model/account';
import { closeConfirmAndWait, IdentityBlock, PageLayout, showFailure } from './common';

const SIGN_OUT = 'sign-out';
const DELETE = 'account-delete';

/** Compte (03 §4.11): identity, sign-out and account deletion. */
export function AccountPage() {
  const { user } = useSession();
  const household = useActiveHousehold();
  const members = useMembers();
  const { pendingCount } = useSyncSummary();
  const online = useOnline();
  const overlay = useOverlay();
  const [busy, setBusy] = useState(false);

  const name = user?.name ?? user?.email ?? '';
  const deletion = user ? accountDeletion(user.id, members) : { kind: 'member' as const };
  const householdName = household.name ?? t('household.title');
  const deleteMessage =
    deletion.kind === 'transfer'
      ? t('account.delete.messageTransfer', { name: deletion.successor.displayName, household: householdName })
      : deletion.kind === 'alone'
        ? t('account.delete.messageAlone', { household: householdName })
        : t('account.delete.message');

  const runSignOut = async () => {
    setBusy(true);
    await closeConfirmAndWait();
    // signOut() turns push off on this device, stops sync and wipes local data; the guards then show /welcome.
    await signOut().finally(() => setBusy(false));
  };

  const runDelete = async () => {
    setBusy(true);
    await closeConfirmAndWait();
    const result = await withSettingsApi((api) => api.deleteAccount());
    if (!result.ok) {
      setBusy(false);
      showFailure(result.reason);
      return;
    }
    await signOut().finally(() => setBusy(false));
  };

  return (
    <PageLayout page="account">
      <IdentityBlock avatarUrl={user?.avatarUrl} name={name} lines={[user?.email ?? null, t('account.provider')]} />

      <ListSection label={t('account.provider')} footer={online ? undefined : t('account.delete.offline')}>
        <ListRow variant="button" title={t('account.signOut')} disabled={busy} onPress={() => openConfirm(SIGN_OUT)} />
        <ListRow
          variant="destructive"
          title={t('account.delete')}
          disabled={busy || !online}
          onPress={() => openConfirm(DELETE)}
        />
      </ListSection>

      <ConfirmDialog
        open={overlay.confirm === SIGN_OUT}
        onOpenChange={(open) => !open && void closeConfirmAndWait()}
        title={t('account.signOut.title')}
        message={pendingCount > 0 ? t('account.signOut.pending', { n: pendingCount }) : t('account.signOut.message')}
        actions={[
          pendingCount > 0
            ? { label: t('account.signOut.force'), destructive: true, onPress: () => void runSignOut() }
            : { label: t('account.signOut'), onPress: () => void runSignOut() },
        ]}
        cancelLabel={pendingCount > 0 ? t('account.signOut.wait') : t('common.cancel')}
      />
      <ConfirmDialog
        open={overlay.confirm === DELETE}
        onOpenChange={(open) => !open && void closeConfirmAndWait()}
        title={t('account.delete.title')}
        message={deleteMessage}
        actions={[{ label: t('account.delete'), destructive: true, onPress: () => void runDelete() }]}
        cancelLabel={t('common.cancel')}
      />
    </PageLayout>
  );
}
