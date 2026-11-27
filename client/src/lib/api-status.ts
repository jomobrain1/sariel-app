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
