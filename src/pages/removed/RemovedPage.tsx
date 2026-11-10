import { HousePlus, Users, UserX } from 'lucide-react';
import { useState } from 'react';
import { closeConfirm, navigateTo, openConfirm, useOverlay } from '@/app/navigation';
import { leaveRemovedHousehold, quarantine, signOut, useActiveHousehold } from '@/app/session';
import { useSyncSummary } from '@/entities/sync';
import { t } from '@/shared/i18n';
import { Button, Card, ConfirmDialog, OnboardingPage, OptionCard } from '@/shared/ui';
import { HeroIcon } from '@/widgets/onboarding/HeroIcon';

const CONFIRM_DISCARD = 'discard-quarantine';

async function exportCsv(): Promise<boolean> {
  const csv = quarantine.csv();
  const name = `cellier-modifications-${new Date().toISOString().slice(0, 10)}.csv`;
  const file = new File([csv], name, { type: 'text/csv' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return true;
    }
  } catch (error) {
    // Share sheet dismissed: not exported.
    if ((error as { name?: string })?.name === 'AbortError') return false;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/**
 * «Accès au foyer retiré» (design 03 §4.16): membership revoked or household deleted. Changes made
 * here that could not be sent are quarantined; they are exported or discarded before the account
 * creates or joins another household.
 */
export function RemovedPage() {
  const household = useActiveHousehold();
  const { quarantined } = useSyncSummary();
  const overlay = useOverlay();
  const [handled, setHandled] = useState(false);
  const count = quarantined.length;
  const canLeave = handled || count === 0;

  const leaveTo = async (path: '/onboarding/create' | '/onboarding/join') => {
    await leaveRemovedHousehold();
    navigateTo(path, { replace: true });
  };

  const discard = async () => {
    closeConfirm();
    await quarantine.discard();
    setHandled(true);
  };

  return (
    <OnboardingPage
      hero={<HeroIcon icon={UserX} />}
      title={t('removed.title')}
      body={t('removed.body', { household: household.name ?? '…' })}
      secondary={{ label: t('account.signOut'), onPress: () => void signOut(), tone: 'quiet' }}
    >
      <div className="mt-4 flex w-full flex-col gap-3 text-left">
        {count > 0 && !handled ? (
          <Card>
            <p className="type-body">{t('removed.quarantine', { n: count })}</p>
            <div className="mt-3 flex flex-col gap-2">
              <Button
                fullWidth
                variant="secondary"
                onClick={() => void exportCsv().then((done) => done && setHandled(true))}
              >
                {t('removed.export')}
              </Button>
              <Button fullWidth variant="destructive-plain" onClick={() => openConfirm(CONFIRM_DISCARD)}>
                {t('removed.discard')}
              </Button>
            </div>
          </Card>
        ) : null}
        {canLeave ? (
          <>
            <OptionCard
              icon={HousePlus}
              title={t('onboarding.household.create.title')}
              subtitle={t('onboarding.household.create.detail')}
              onPress={() => void leaveTo('/onboarding/create')}
            />
            <OptionCard
              icon={Users}
              title={t('onboarding.household.join.title')}
              subtitle={t('onboarding.household.join.detail')}
              onPress={() => void leaveTo('/onboarding/join')}
            />
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={overlay.confirm === CONFIRM_DISCARD}
        onOpenChange={(open) => !open && closeConfirm()}
        title={t('removed.discard.title', { n: count })}
        actions={[{ label: t('common.delete'), destructive: true, onPress: () => void discard() }]}
        cancelLabel={t('common.cancel')}
      />
    </OnboardingPage>
  );
}
