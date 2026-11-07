import { appendTrait, descriptionOk, DESIGN_CHIPS, previewsLeft } from '../designFlow';

describe('design flow rules', () => {
  it('appends a trait once, comma-separated, case-insensitively', () => {
    expect(appendTrait('', 'warm')).toBe('warm');
    expect(appendTrait('calm,', 'warm')).toBe('calm, warm');
    expect(appendTrait('calm, WARM', 'warm')).toBe('calm, WARM');
  });
  it('the chip traits are the web English phrases', () => {
    expect(DESIGN_CHIPS.tone.raspy).toBe('slightly raspy');
    expect(DESIGN_CHIPS.gender.neutral).toBe('androgynous');
  });
  it('the description is 1 to 1000 characters', () => {
    expect(descriptionOk('')).toBe(false);
    expect(descriptionOk('a'.repeat(1000))).toBe(true);
    expect(descriptionOk('a'.repeat(1001))).toBe(false);
  });
  it('three previews per description, then none left', () => {
    expect([0, 1, 3, 4].map(previewsLeft)).toEqual([3, 2, 0, 0]);
  });
});
