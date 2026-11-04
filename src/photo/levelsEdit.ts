// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/levelsEdit.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/** Pure Levels field editing: input black stays below input white; ranges clamp. */
import type { LevelsChannel } from './photoTypes';

export interface LevelsValues {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}
export type LevelsField = keyof LevelsValues;
export const LEVELS_MIN_SPAN = 0.01;
export const LEVELS_DEFAULT: LevelsValues = { inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 };
export type { LevelsChannel };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Set one field, clamping to its range and keeping the black point below the white point. */
export function setLevelsField(v: LevelsValues, field: LevelsField, value: number): LevelsValues {
  if (!Number.isFinite(value)) return v;
  let next = { ...v };
  switch (field) {
    case 'gamma':
      next.gamma = clamp(value, 0.1, 10);
      break;
    case 'inBlack':
      next.inBlack = clamp(value, 0, v.inWhite - LEVELS_MIN_SPAN);
      break;
    case 'inWhite':
      next.inWhite = clamp(value, v.inBlack + LEVELS_MIN_SPAN, 1);
      break;
    case 'outBlack':
      next.outBlack = clamp(value, 0, 1);
      break;
    case 'outWhite':
      next.outWhite = clamp(value, 0, 1);
      break;
  }
  if (next[field] === v[field]) next = v;
  return next;
}

export const isIdentityLevels = (v: LevelsValues) => (Object.keys(LEVELS_DEFAULT) as LevelsField[]).every((k) => v[k] === LEVELS_DEFAULT[k]);

/** The slider position (0..1) for a gamma value on a log scale 0.1..10. */
export const gammaToPos = (g: number) => (Math.log10(clamp(g, 0.1, 10)) + 1) / 2;
export const posToGamma = (p: number) => Math.round(Math.pow(10, clamp(p, 0, 1) * 2 - 1) * 100) / 100;
