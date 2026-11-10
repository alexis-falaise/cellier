import { createFileRoute } from '@tanstack/react-router';
import { ItemHistoryPage } from '@/pages/item/ItemHistoryPage';

export const Route = createFileRoute('/_tabs/items/$productId/history')({
  component: ItemHistoryPage,
});
