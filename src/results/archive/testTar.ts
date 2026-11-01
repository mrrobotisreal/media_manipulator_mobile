/** Test-only tar writer: ustar headers, GNU `L` long names, optional dirs. Not shipped. */
export interface TestTarFile {
  path: string;
  data?: Uint8Array;
  dir?: boolean;
}

const enc = new TextEncoder();

function header(name: string, size: number, flag: string): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, at: number) => h.set(enc.encode(s), at);
  put(name.slice(0, 100), 0);
  put('0000644\0', 100);
  put('0000000\0', 108);
  put('0000000\0', 116);
  put(size.toString(8).padStart(11, '0') + '\0', 124);
  put('00000000000\0', 136);
  put('        ', 148);
  put(flag, 156);
  put('ustar\0', 257);
  put('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

const pad = (n: number) => new Uint8Array((512 - (n % 512)) % 512);

export function writeTar(files: TestTarFile[], opts: { terminate?: boolean } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of files) {
    const data = f.data ?? new Uint8Array();
    const name = f.dir ? f.path.replace(/\/?$/, '/') : f.path;
    if (enc.encode(name).length > 100) {
      const long = enc.encode(name + '\0');
      parts.push(header('././@LongLink', long.length, 'L'), long, pad(long.length));
    }
    parts.push(header(name, f.dir ? 0 : data.length, f.dir ? '5' : '0'));
    if (!f.dir) parts.push(data, pad(data.length));
  }
  if (opts.terminate !== false) parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
