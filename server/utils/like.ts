/**
 * LIKE/ILIKE metacharacters in user input must match themselves: `%` and `_`
 * are wildcards and `\` is Postgres' default escape character.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `%term%` with the term's own wildcards escaped, for a "contains" search. */
export function containsPattern(term: string): string {
  return `%${escapeLike(term)}%`;
}
