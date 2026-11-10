import { createFileRoute } from '@tanstack/react-router';
import { TabLayout } from '@/widgets/app-shell';

/** Tab shell: renders the whole stack of the current tab (each leaf route below renders one page). */
export const Route = createFileRoute('/_tabs')({
  component: TabLayout,
});
