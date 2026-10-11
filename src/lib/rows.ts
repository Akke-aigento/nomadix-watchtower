/**
 * Rij-normalisatie voor views.
 *
 * PostgREST kan de NOT NULL-garanties van de onderliggende tabellen niet door een view
 * heen afleiden, dus elke kolom van o.a. `agenda` en `credit_latest` komt nullable uit
 * de gegenereerde types. Welke velden die views in élk geval invullen, wél bekend:
 * die lijst doorgeven en rijen zonder die velden vallen weg, de rest komt
 * niet-nullable mee. Eén grens met één assertie, in plaats van losse casts door de code.
 */

export type WithFields<T, K extends keyof T> = Omit<T, K> & {
  [P in K]-?: NonNullable<T[P]>;
};

export function rowsWith<T extends object, K extends keyof T>(
  rows: readonly T[] | null | undefined,
  required: readonly K[],
): WithFields<T, K>[] {
  const out: WithFields<T, K>[] = [];
  for (const row of rows ?? []) {
    if (required.some((key) => row[key] == null)) continue;
    out.push(row as unknown as WithFields<T, K>);
  }
  return out;
}
