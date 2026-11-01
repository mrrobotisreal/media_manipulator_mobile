export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Incremental Server-Sent Events parser (WHATWG "event stream" rules, minus id/retry).
 * `push` takes decoded text in any chunking. Comment lines (`: keepalive`) call `onComment`.
 */
export function createSseParser(
  onMessage: (m: SseMessage) => void,
  onComment: () => void = () => undefined,
) {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let sawField = false;

  const dispatch = () => {
    if (data.length > 0 || sawField) {
      if (data.length > 0) onMessage({ event: event || 'message', data: data.join('\n') });
    }
    event = '';
    data = [];
    sawField = false;
  };

  const line = (l: string) => {
    if (l === '') return dispatch();
    if (l.startsWith(':')) return onComment();
    const i = l.indexOf(':');
    const field = i === -1 ? l : l.slice(0, i);
    let value = i === -1 ? '' : l.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      event = value;
      sawField = true;
    } else if (field === 'data') {
      data.push(value);
      sawField = true;
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      let m: RegExpExecArray | null;
      // A lone trailing \r may be half of \r\n: leave it buffered until the next chunk.
      const re = /\r\n|\n|\r(?!$)/g;
      let last = 0;
      while ((m = re.exec(buffer))) {
        line(buffer.slice(last, m.index));
        last = m.index + m[0].length;
      }
      buffer = buffer.slice(last);
    },
  };
}
