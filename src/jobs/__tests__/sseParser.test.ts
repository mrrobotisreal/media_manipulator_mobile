import { createSseParser, type SseMessage } from '../sseParser';

function run(chunks: string[]) {
  const msgs: SseMessage[] = [];
  let comments = 0;
  const p = createSseParser(
    (m) => msgs.push(m),
    () => (comments += 1),
  );
  chunks.forEach((c) => p.push(c));
  return { msgs, comments };
}

describe('sseParser', () => {
  it('parses an update event', () => {
    expect(run(['event: update\ndata: {"a":1}\n\n']).msgs).toEqual([
      { event: 'update', data: '{"a":1}' },
    ]);
  });
  it('counts comment lines without emitting a message', () => {
    const r = run([': keepalive\n\n']);
    expect(r.msgs).toEqual([]);
    expect(r.comments).toBe(1);
  });
  it('joins multi-line data with \\n', () => {
    expect(run(['event: update\ndata: a\ndata: b\n\n']).msgs[0]!.data).toBe('a\nb');
  });
  it('handles chunks split anywhere, including mid-field and mid-CRLF', () => {
    const whole =
      'event: update\r\ndata: {"x":"y"}\r\n\r\n: keepalive\r\n\r\nevent: update\ndata: 2\n\n';
    for (let cut = 1; cut < whole.length; cut++) {
      const r = run([whole.slice(0, cut), whole.slice(cut)]);
      expect(r.msgs.map((m) => m.data)).toEqual(['{"x":"y"}', '2']);
      expect(r.comments).toBe(1);
    }
  });
  it('defaults the event name to message and strips one leading space only', () => {
    expect(run(['data:  two\n\n']).msgs).toEqual([{ event: 'message', data: ' two' }]);
  });
  it('ignores unknown fields and blank dispatches', () => {
    expect(run(['id: 5\nretry: 10\n\n\n']).msgs).toEqual([]);
  });
});
