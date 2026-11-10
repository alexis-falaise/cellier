import { createRouter } from '@tanstack/react-router';
import { bindNavigationRouter } from './navigation';
import { routeTree } from './routeTree.gen';
import { parseQueryString, stringifyQuery } from './search';
import { bootstrapSession, subscribeAppSession } from './session';

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: false,
  // Plain strings in the URL (no JSON); route validators type them (src/app/search.ts).
  parseSearch: parseQueryString,
  stringifySearch: stringifyQuery,
});

bindNavigationRouter(router);
void bootstrapSession();
// Session changes (sign-in, expiry, removal, household created) re-run the root guard.
subscribeAppSession(() => {
  void router.invalidate();
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
