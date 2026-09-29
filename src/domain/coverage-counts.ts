/** Count non-empty string values by a record field in stable key order. */
export function countStringField<Records extends object>(
  records: readonly Records[],
  field: keyof Records,
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = record[field];
    if (typeof value === "string" && value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}
