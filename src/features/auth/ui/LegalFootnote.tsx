import { Link } from '@tanstack/react-router';
import { Fragment } from 'react';
import { t } from '@/shared/i18n';

const TERMS = '\u0000terms\u0000';
const PRIVACY = '\u0000privacy\u0000';

/** «En continuant, vous acceptez les conditions d’utilisation et la politique de confidentialité.» */
export function LegalFootnote() {
  const parts = t('auth.legal', { terms: TERMS, privacy: PRIVACY }).split('\u0000');
  return (
    <p className="max-w-[320px] text-center type-footnote text-label-secondary">
      {parts.map((part, i) => {
        const key = `${i}-${part}`;
        if (part === 'terms')
          return (
            <Link
              key={key}
              to="/legal/terms"
              className="text-accent-fg underline outline-none focus-visible:focus-ring"
            >
              {t('auth.legal.terms')}
            </Link>
          );
        if (part === 'privacy')
          return (
            <Link
              key={key}
              to="/legal/privacy"
              className="text-accent-fg underline outline-none focus-visible:focus-ring"
            >
              {t('auth.legal.privacy')}
            </Link>
          );
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </p>
  );
}
