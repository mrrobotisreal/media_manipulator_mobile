import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const FORBIDDEN = [
  /\b(margin|padding)(Left|Right)\b/,
  /(?<![\w-])(left|right)\s*:/,
  /(?<![\w:-])-?(ml|mr|pl|pr)-[\w[]/,
  /\b(border|rounded)-(l|r|tl|tr|bl|br)(-|\b)/,
  /\btext-(left|right)\b/,
];

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== 'generated' && e !== '__tests__') files(p, out);
    } else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

describe('RTL: logical styles only', () => {
  it('app/ and src/ui use start/end, never left/right', () => {
    const hits: string[] = [];
    for (const f of [...files(join(ROOT, 'app')), ...files(join(ROOT, 'src/ui'))]) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (FORBIDDEN.some((re) => re.test(line)))
            hits.push(`${f.replace(ROOT + '/', '')}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
