import { createFileRoute } from '@tanstack/react-router';
import { parseJoinSearch } from '@/app/search';
import { JoinCodePage } from '@/pages/onboarding/JoinCodePage';

export const Route = createFileRoute('/onboarding/join')({
  validateSearch: parseJoinSearch,
  component: JoinCodePage,
});
