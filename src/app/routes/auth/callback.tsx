import { createFileRoute } from '@tanstack/react-router';
import { AuthCallbackPage } from '@/pages/auth-callback/AuthCallbackPage';

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
});
