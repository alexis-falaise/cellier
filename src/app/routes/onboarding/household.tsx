import { createFileRoute } from '@tanstack/react-router';
import { HouseholdChoicePage } from '@/pages/onboarding/HouseholdChoicePage';

export const Route = createFileRoute('/onboarding/household')({
  component: HouseholdChoicePage,
});
