import { useState } from 'react';
import { chooseLanguage } from '@/app/session';
import { getLocale, LOCALE_NAMES, LOCALES, type Locale, t } from '@/shared/i18n';
import { ListRow, ListSection } from '@/shared/ui';
import { PageLayout } from './common';

/**
 * Langue: one row per language, each named in itself so it can be found whatever the current one.
 * The choice is the user's own (saved on the account); picking one reloads the app in it, and the
 * URL brings the sheet back on this page.
 */
export function LanguagePage() {
  const [selected, setSelected] = useState<Locale>(getLocale);
  const [changing, setChanging] = useState(false);

  const choose = (locale: Locale) => {
    if (changing || locale === selected) return;
    setSelected(locale);
    setChanging(true);
    void chooseLanguage(locale).finally(() => setChanging(false));
  };

  return (
    <PageLayout page="language">
      <ListSection label={t('language.title')} footer={t('language.footer')}>
        {LOCALES.map((locale) => (
          <ListRow
            key={locale}
            variant="value"
            title={<span lang={locale}>{LOCALE_NAMES[locale]}</span>}
            selected={selected === locale}
            disabled={changing && selected !== locale}
            onPress={() => choose(locale)}
          />
        ))}
      </ListSection>
      <p className="-mt-4 px-8 type-footnote text-label-secondary">{t('language.dataFooter')}</p>
    </PageLayout>
  );
}
