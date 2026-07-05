import { TimeoutError } from "./withTimeout";

export function isUnreachableBackendError(error: unknown): boolean {
  if (error instanceof TimeoutError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);

  return /fetch failed|connectexception|network request failed|econnrefused|enotfound|timed out|unable to resolve host|network error|failed to connect|sockettimeout/i.test(
    message
  );
}
