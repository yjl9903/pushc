export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown error';
}
