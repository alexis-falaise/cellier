import { createFileRoute } from '@tanstack/react-router';
import { UiGalleryPage } from '@/pages/dev/UiGalleryPage';

export const Route = createFileRoute('/dev/ui')({
  component: UiGalleryPage,
});
