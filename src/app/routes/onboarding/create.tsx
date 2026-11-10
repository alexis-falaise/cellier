import { createFileRoute } from '@tanstack/react-router';
import { CreateHouseholdPage } from '@/pages/onboarding/CreateHouseholdPage';

export const Route = createFileRoute('/onboarding/create')({
  component: CreateHouseholdPage,
});
