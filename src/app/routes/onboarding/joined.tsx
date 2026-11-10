import { createFileRoute } from '@tanstack/react-router';
import { JoinedPage } from '@/pages/onboarding/JoinedPage';

export const Route = createFileRoute('/onboarding/joined')({
  component: JoinedPage,
});
