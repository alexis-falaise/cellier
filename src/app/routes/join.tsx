import { createFileRoute } from '@tanstack/react-router';
import { JoinLandingPage } from '@/pages/onboarding/JoinLandingPage';

export const Route = createFileRoute('/join')({
  component: JoinLandingPage,
});
