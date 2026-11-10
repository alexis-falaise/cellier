import { createFileRoute } from '@tanstack/react-router';
import { ActivityPage } from '@/pages/activity/ActivityPage';

export const Route = createFileRoute('/_tabs/activity')({
  component: ActivityPage,
});
