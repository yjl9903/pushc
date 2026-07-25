export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

export function emptyRecord<T>(): Readonly<Record<string, T>> {
  return Object.create(null) as Record<string, T>;
}

export function recordFromMap<T>(values: ReadonlyMap<string, T>): Readonly<Record<string, T>> {
  const result = Object.create(null) as Record<string, T>;
  for (const [key, value] of values) result[key] = value;
  return result;
}
