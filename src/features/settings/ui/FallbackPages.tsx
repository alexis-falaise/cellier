import { History } from 'lucide-react';
import { pushActivity } from '@/app/navigation';
import { useIsOwner } from '@/entities/member';
import { usePantries } from '@/entities/pantry';
import { t } from '@/shared/i18n';
import { EmptyState, ListRow, ListSection } from '@/shared/ui';
import { closeSheetAndWait, PageLayout } from './common';

/**
 * Read-only list of celliers, shown until the pantries feature registers its own pages
 * (`registerSettingsPage('pantries', …)`).
 */
export function FallbackPantriesPage() {
  const pantries = usePantries();
  const isOwner = useIsOwner();
  return (
    <PageLayout page="pantries">
      <ListSection header={t('pantries.title')} footer={isOwner ? undefined : t('pantries.footer.member')}>
        {pantries.map((p) => (
          <ListRow key={p.id} variant="plain" title={p.name} />
        ))}
      </ListSection>
    </PageLayout>
  );
}

/** Until the activity page is registered inside the sheet, it opens the `/activity` screen. */
export function FallbackActivityPage() {
  return (
    <PageLayout page="activity">
      <EmptyState
        className="mt-12"
        icon={History}
        title={t('household.activity')}
        action={{ label: t('common.open'), onPress: () => void closeSheetAndWait().then(pushActivity) }}
      />
    </PageLayout>
  );
}
