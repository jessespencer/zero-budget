const MIN_PAYEE_LENGTH = 3;

/**
 * Find the best matching known payee for an imported payee name.
 * Uses case-insensitive substring matching with longest-match-wins.
 * Returns the matched payee's name (original casing) or null.
 */
export function findBestPayeeMatch(
  importedPayee: string,
  knownPayees: { name: string }[]
): string | null {
  const lower = importedPayee.toLowerCase();
  let bestMatch: string | null = null;
  let bestLength = 0;

  for (const payee of knownPayees) {
    if (payee.name.length < MIN_PAYEE_LENGTH) continue;
    if (lower.includes(payee.name.toLowerCase()) && payee.name.length > bestLength) {
      bestMatch = payee.name;
      bestLength = payee.name.length;
    }
  }

  return bestMatch;
}
