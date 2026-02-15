export function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function compareLocalDate(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
