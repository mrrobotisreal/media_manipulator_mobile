import { TOOLS } from '../registry';
import { matchesQuery, searchTools, type SearchableTool } from '../search';

const items = (
  over: Partial<Record<string, { title: string; description: string }>> = {},
): SearchableTool[] =>
  TOOLS.map((tool) => ({
    tool,
    englishTitle: tool.id.replace(/-/g, ' '),
    title: over[tool.id]?.title ?? tool.id.replace(/-/g, ' '),
    description: over[tool.id]?.description ?? '',
  }));

const ids = (q: string, list = items()) =>
  searchTools(list, q).flatMap((s) => s.data.map((d) => d.tool.id));

describe('tool search', () => {
  it('empty query returns every family in order', () => {
    expect(searchTools(items(), '').map((s) => s.family)).toEqual([
      'image',
      'video',
      'audio',
      'ai',
      'metadata',
    ]);
  });
  it('matches the locale title', () => {
    const l = items({ 'image-resize': { title: 'Größe ändern', description: '' } });
    expect(ids('größe', l)).toContain('image-resize');
  });
  it('falls back to the English title when the locale title differs', () => {
    const l = items({ 'image-resize': { title: 'Größe ändern', description: '' } });
    expect(ids('resize', l)).toContain('image-resize');
  });
  it('matches keywords (gif, mp3, exif)', () => {
    expect(ids('gif')).toContain('video-to-gif');
    expect(ids('mp3')).toContain('video-extract-audio');
    expect(ids('exif')).toContain('strip-metadata');
  });
  it('is diacritic- and case-insensitive', () => {
    const l = items({ 'image-resize': { title: 'Größe ändern', description: 'Café' } });
    expect(ids('GROSSE'.replace('SS', 'ß'), l)).toContain('image-resize');
    expect(ids('grobe ander', l)).toEqual([]);
    expect(ids('cafe', l)).toContain('image-resize');
    expect(ids('AANDERN', l)).toEqual([]);
    expect(ids('andern', l)).toContain('image-resize');
  });
  it('returns nothing for a nonsense query and keeps grouping otherwise', () => {
    expect(ids('zzzqqq')).toEqual([]);
    const sections = searchTools(items(), 'audio');
    expect(sections.length).toBeGreaterThan(1);
    for (const s of sections) for (const d of s.data) expect(d.tool.family).toBe(s.family);
  });
  it('matchesQuery requires every term', () => {
    const [first] = items();
    expect(matchesQuery(first!, 'image qqq')).toBe(false);
  });
});
