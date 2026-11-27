/** HTTP status from a failed API call (Tilcayo errors carry `statusCode`), or 0 for network errors. */
export function apiStatus(error: unknown): number {
  if (typeof error !== 'object' || !error) return 0;
  const value = 'statusCode' in error ? error.statusCode : 'status' in error ? error.status : 0;
  return typeof value === 'number' ? value : 0;
}

/** Machine-readable error code from a failed API call (e.g. AI_BUSY), if any. */
export function apiCode(error: unknown): string {
  if (typeof error !== 'object' || !error || !('code' in error)) return '';
  return typeof error.code === 'string' ? error.code : '';
}

/** Server-provided message from a failed API call, or `fallback` for network errors. */
export function apiMessage(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || !error || !('message' in error) || !apiStatus(error)) return fallback;
  return typeof error.message === 'string' && error.message ? error.message : fallback;
}

/** A readable reason a circle invite failed. */
export function inviteError(error: unknown): string {
  const status = apiStatus(error);
  if (status === 409) return 'This address is already in your circle.';
  if (status === 401) return 'Your session expired. Sign in again, then retry.';
  if (status === 429) return 'Too many invites for now. Try again in an hour.';
  return apiMessage(error, 'Couldn’t reach Sariel. Check your connection and try again.');
}
