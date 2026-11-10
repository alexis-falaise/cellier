import { createFileRoute } from '@tanstack/react-router';
import { ItemDetailPage } from '@/pages/item/ItemDetailPage';

export const Route = createFileRoute('/_tabs/groceries/items/$productId/')({
  component: ItemDetailPage,
});
