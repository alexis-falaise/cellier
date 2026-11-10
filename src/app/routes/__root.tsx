import { createRootRoute, redirect } from '@tanstack/react-router';
import { decideRedirect } from '@/app/guards';
import { parseGlobalSearch } from '@/app/search';
import { guardState, settled } from '@/app/session';
import { AppRoot, NotFoundPage } from '@/widgets/app-shell';

export const Route = createRootRoute({
  validateSearch: parseGlobalSearch,
  beforeLoad: async ({ location }) => {
    await settled();
    const target = decideRedirect(guardState(), location.pathname);
    if (target) throw redirect({ href: target.href, replace: true });
  },
  component: AppRoot,
  notFoundComponent: NotFoundPage,
});
