export function queryValues(params: URLSearchParams, name: string): string[] {
  return params.getAll(name).flatMap(value => value.split(",")).map(value => value.trim()).filter(Boolean);
}
