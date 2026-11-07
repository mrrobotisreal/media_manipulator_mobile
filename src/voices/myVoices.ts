/** Pure rules of the My voices screen (ticket MA34 decision 9). */

/** `used / limit` for the mono-numeral readout; limit -1 = unlimited. */
export function usageParts(used: number, limit: number): { used: number; limit: number | null } {
  return { used, limit: limit === -1 ? null : limit };
}

/** True when the plan cannot save another voice (`used >= limit`, unlimited never). */
export const isFull = (used: number, limit: number): boolean => limit !== -1 && used >= limit;
