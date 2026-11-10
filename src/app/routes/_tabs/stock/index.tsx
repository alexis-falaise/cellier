import { createFileRoute } from '@tanstack/react-router';
import { parseStockSearch } from '@/app/search';
import { StockPage } from '@/pages/stock/StockPage';

export const Route = createFileRoute('/_tabs/stock/')({
  validateSearch: parseStockSearch,
  component: StockPage,
});
