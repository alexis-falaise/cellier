import { createFileRoute } from '@tanstack/react-router';
import { parseAuthCallbackSearch } from '@/app/search';
import { AuthCallbackPage } from '@/pages/auth-callback/AuthCallbackPage';

export const Route = createFileRoute('/auth/callback')({
  validateSearch: parseAuthCallbackSearch,
  component: AuthCallbackPage,
});
