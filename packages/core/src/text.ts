/** "1 customer", "3 customers", "1 party", "2 parties". `many` defaults to `one` + "s". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
