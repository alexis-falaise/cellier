import { enterHousehold, getAppSession, refreshMembership } from '@/app/session';
import { clearPendingInvite, getHouseholdApi, inviteErrorKey } from '@/features/auth';
import { t } from '@/shared/i18n';

/**
 * `accept_invite` after sign-in, shared by «Rejoindre un foyer» and the `/join#CODE` landing.
 * On success the joined household becomes the active one (sync started); otherwise the copy to show.
 */
export async function acceptInviteCode(
  code: string,
  householdName: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // One household per account (v1): an existing membership blocks joining.
  await refreshMembership();
  const current = getAppSession().household;
  if (current.phase === 'member' && current.id) {
    return { ok: false, message: t('onboarding.join.error.alreadyMember', { household: householdName ?? '' }) };
  }
  const result = await getHouseholdApi().acceptInvite(code);
  if (!result.ok) {
    return {
      ok: false,
      message: result.reason === 'offline' ? t('onboarding.join.offline') : t('onboarding.join.error.generic'),
    };
  }
  const { status, householdId } = result.result;
  if ((status === 'joined' || status === 'already_member') && householdId) {
    clearPendingInvite();
    await enterHousehold(householdId);
    return { ok: true };
  }
  const key = inviteErrorKey(status);
  // A dead code is not retried after the next sign-in.
  if (key && key !== 'onboarding.join.error.rateLimited') clearPendingInvite();
  return { ok: false, message: key ? t(key) : t('onboarding.join.error.generic') };
}
