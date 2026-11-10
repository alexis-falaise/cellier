import { createFileRoute } from '@tanstack/react-router';
import { GroceriesPage } from '@/pages/groceries/GroceriesPage';

export const Route = createFileRoute('/_tabs/groceries/')({
  component: GroceriesPage,
});
