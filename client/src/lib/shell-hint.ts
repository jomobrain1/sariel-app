// Non-sensitive layout preference; never used for authorization.
export const shellHintKey='sariel.shell';
export function lastShell(): string|null { try { return sessionStorage.getItem(shellHintKey); } catch { return null; } }
