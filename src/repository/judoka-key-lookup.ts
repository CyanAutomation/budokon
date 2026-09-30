import type { Judoka } from "../domain/types.js";
import { normalizeSearchText } from "../domain/catalog-filters.js";

function matchesName(judoka: Judoka, normalizedKey: string): boolean {
  const names = [
    judoka.firstname,
    judoka.surname,
    `${judoka.firstname ?? ""} ${judoka.surname ?? ""}`.trim(),
    ...(judoka.aliases ?? []),
  ];
  return names.some(name => normalizeSearchText(name) === normalizedKey);
}

export function findJudokaByKey(records: readonly Judoka[], key: string | undefined): Judoka | undefined {
  if (key === undefined) return undefined;
  const normalizedKey = normalizeSearchText(key);
  return records.find(judoka =>
    judoka.id === key
    || judoka.slug === key
    || Boolean(judoka.legacySlugs?.includes(key))
    || matchesName(judoka, normalizedKey));
}
