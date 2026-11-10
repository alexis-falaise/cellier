import { createFileRoute } from '@tanstack/react-router';
import { RemovedPage } from '@/pages/removed/RemovedPage';

export const Route = createFileRoute('/removed')({
  component: RemovedPage,
});
