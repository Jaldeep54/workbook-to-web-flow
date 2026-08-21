import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

/**
 * One QueryClient for the app. Failed requests aren't retried when the server
 * has already given a definitive answer (401/403/404/422) — retrying a
 * permission failure just delays the error the user needs to see.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status;
        if (status && [400, 401, 403, 404, 409, 422].includes(status)) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
    },
  },
});

export const getRouter = () =>
  createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
