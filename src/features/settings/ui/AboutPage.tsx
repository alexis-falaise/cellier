import { ExternalLink } from 'lucide-react';
import { navigateTo } from '@/app/navigation';
import { t } from '@/shared/i18n';
import { ListRow, ListSection } from '@/shared/ui';
import { APP_BUILD, APP_VERSION } from '../model/version';
import { closeSheetAndWait, PageLayout } from './common';

const OFF_URL = 'https://world.openfoodfacts.org';

function Paragraph({ children }: { children: string }) {
  return <p className="px-4 py-3 type-body text-label-primary text-pretty">{children}</p>;
}

/** Leaves the sheet, then opens an in-app page (the legal pages are routes outside the tabs). */
function openLegal(path: '/legal/terms' | '/legal/privacy') {
  void closeSheetAndWait().then(() => navigateTo(path));
}

/** Sources des données (03 §4.15): Open Food Facts (ODbL) and Open Prices attribution, icons, legal, version. */
export function AboutPage() {
  return (
    <PageLayout page="about">
      <ListSection header={t('about.products')}>
        {/* biome-ignore lint/a11y/useSemanticElements: rows of the inset list */}
        <div role="listitem">
          <Paragraph>{t('about.off')}</Paragraph>
        </div>
        <ListRow
          variant="button"
          title={t('about.offLink')}
          href={OFF_URL}
          trailing={<ExternalLink size={17} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />}
          onPress={() => window.open(OFF_URL, '_blank', 'noopener,noreferrer')}
        />
      </ListSection>

      <ListSection header={t('about.prices')}>
        {/* biome-ignore lint/a11y/useSemanticElements: rows of the inset list */}
        <div role="listitem">
          <Paragraph>{t('about.openPrices')}</Paragraph>
        </div>
      </ListSection>

      <ListSection header={t('about.icons')}>
        {/* biome-ignore lint/a11y/useSemanticElements: rows of the inset list */}
        <div role="listitem">
          <Paragraph>{t('about.lucide')}</Paragraph>
        </div>
      </ListSection>

      <ListSection header={t('about.legal')}>
        <ListRow title={t('legal.terms.title')} href="/legal/terms" onPress={() => openLegal('/legal/terms')} />
        <ListRow title={t('legal.privacy.title')} href="/legal/privacy" onPress={() => openLegal('/legal/privacy')} />
      </ListSection>

      <ListSection label={t('about.version')}>
        <ListRow variant="plain" title={t('about.version')} value={`${APP_VERSION} (${APP_BUILD})`} />
      </ListSection>
    </PageLayout>
  );
}
