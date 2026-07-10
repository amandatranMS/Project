/**
 * Generates a synthetic business id (e.g. "MS-1783...") when a client doesn't
 * supply one. Real workbook ids (MS-001, REC-001, ...) are preserved on import;
 * these are only used for records created at runtime through the API.
 */
export function genId(prefix: string): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `${prefix}-${stamp}${rand}`;
}
