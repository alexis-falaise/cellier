import { createFileRoute } from '@tanstack/react-router';
import { ItemHistoryPage } from '@/pages/item/ItemHistoryPage';

export const Route = createFileRoute('/_tabs/groceries/items/$productId/history')({
  component: ItemHistoryPage,
});
