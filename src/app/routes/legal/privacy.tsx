import { createFileRoute } from '@tanstack/react-router';
import { PrivacyPage } from '@/pages/legal/LegalPage';

export const Route = createFileRoute('/legal/privacy')({
  component: PrivacyPage,
});
