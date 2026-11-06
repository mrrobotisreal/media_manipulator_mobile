/**
 * A deliberately small markdown parser for Medi's answers (ticket MA54 decision 2): paragraphs, bold,
 * italics, bullet and numbered lists, headings (shown as bold lines), inline code (shown as plain
 * text) and links. Nothing else: no HTML, no images (alt text only), no tables (their rows stay as
 * text). The output is a plain tree; the renderer decides what a link may do (`links.ts`).
 */
export type Inline =
  | { t: 'text'; text: string; bold?: boolean; italic?: boolean }
  | { t: 'link'; href: string; children: Inline[] };

export type Block =
  | { t: 'p'; inline: Inline[]; heading?: boolean }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][]; start: number };

const MAX_DEPTH = 3;

interface Style {
  bold?: boolean;
  italic?: boolean;
}

/** Inline parse of one line of text. Unbalanced markers stay literal. */
export function parseInline(src: string, style: Style = {}, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', text: buf, ...style });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\' && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!>~|]/.test(src[i + 1]!)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        buf += src.slice(i + 1, end);
        i = end + 1;
        continue;
      }
    }
    if (c === '!' && src[i + 1] === '[') {
      // An image: only its alt text is shown.
      const m = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(src.slice(i));
      if (m) {
        buf += m[1];
        i += m[0].length;
        continue;
      }
    }
    if (c === '[' && depth < MAX_DEPTH) {
      const m = /^\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/.exec(src.slice(i));
      if (m) {
        flush();
        out.push({ t: 'link', href: m[2]!, children: parseInline(m[1]!, style, depth + 1) });
        i += m[0].length;
        continue;
      }
    }
    if ((c === '*' || c === '_') && depth < MAX_DEPTH) {
      const double = src[i + 1] === c;
      const marker = double ? c + c : c;
      const start = i + marker.length;
      // `_` inside a word is literal (snake_case); an opener must be followed by a non-space.
      const prev = i > 0 ? src[i - 1]! : ' ';
      const intraWord = c === '_' && /\w/.test(prev);
      if (!intraWord && start < src.length && !/\s/.test(src[start]!)) {
        const end = src.indexOf(marker, start);
        if (end > start && !/\s/.test(src[end - 1]!)) {
          flush();
          out.push(
            ...parseInline(
              src.slice(start, end),
              double ? { ...style, bold: true } : { ...style, italic: true },
              depth + 1,
            ),
          );
          i = end + marker.length;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const UL = /^\s{0,3}[-*+]\s+(.*)$/;
const OL = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

/** Block parse. Blank lines separate blocks; list items continue on indented lines. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', inline: parseInline(para.join(' ')) });
    para = [];
  };
  const endList = () => {
    if (list) {
      const items = list.items.map((s) => parseInline(s));
      blocks.push(list.ordered ? { t: 'ol', items, start: list.start } : { t: 'ul', items });
    }
    list = null;
  };

  for (const line of lines) {
    if (line.trim() === '') {
      endPara();
      endList();
      continue;
    }
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      endPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) endList();
      if (!list) {
        list = { ordered, start: ol ? Number(ol[1]) : 1, items: [] };
      }
      list.items.push((ul ? ul[1] : ol![2])!);
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      endPara();
      endList();
      blocks.push({
        t: 'p',
        heading: true,
        inline: parseInline(h[1]!, { bold: true }),
      });
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    endList();
    para.push(line.trim());
  }
  endPara();
  endList();
  return blocks;
}
