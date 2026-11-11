import { createFileRoute } from '@tanstack/react-router';
import { ValuePage } from '@/pages/value/ValuePage';

export const Route = createFileRoute('/_tabs/value')({
  component: ValuePage,
});
