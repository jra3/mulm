/**
 * "Contains" search with LIKE, where what a person typed is matched as text.
 *
 * Unescaped, `%` and `_` in the input are wildcards: `jane_doe` also finds
 * `janexdoe`, and `%%` finds everything. `containsPattern` escapes them (and
 * the escape character), and `containsSql` writes the clause with the ESCAPE
 * that pattern depends on. Use the two together.
 */

/** A LIKE pattern matching text that contains `search`, case-insensitively. */
export function containsPattern(search: string): string {
  const escaped = search.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

/** SQL: `column` contains the `containsPattern` bound to its one parameter. */
export function containsSql(column: string): string {
  return `LOWER(${column}) LIKE ? ESCAPE '\\'`;
}
