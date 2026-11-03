import { createPushHandlers, createRouteQueue, parsePush, type HandlerDeps } from '../handlers';
import type { RemoteMessage } from '../messaging';

const ID = '3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c';
const msg = (data: Record<string, string>, notification?: RemoteMessage['notification']) =>
  ({ data, notification }) as unknown as RemoteMessage;
const ok = msg({
  jobId: ID,
  tool: 'ai-upscale',
  status: 'completed',
  url: `mediamanipulator://job/${ID}`,
});

function make(current: string | null = null) {
  const deps = {
    currentJobId: () => current,
    showToast: jest.fn(),
    refresh: jest.fn(),
    route: jest.fn(),
    trackOpened: jest.fn(),
  } satisfies HandlerDeps;
  return { deps, h: createPushHandlers(deps) };
}

describe('parsePush', () => {
  it('reads tool and status, rejects a non-UUID jobId', () => {
    expect(parsePush(ok)).toEqual({ jobId: ID, tool: 'ai-upscale', status: 'completed' });
    expect(parsePush(msg({ jobId: ID, tool: 'x', status: 'failed' }))?.status).toBe('failed');
    expect(parsePush(msg({ jobId: '../../etc', tool: 'x' }))).toBeNull();
    expect(parsePush(msg({ jobId: `${ID}/x` }))).toBeNull();
    expect(parsePush(msg({}))).toBeNull();
    expect(parsePush(null)).toBeNull();
  });
});

describe('foreground message', () => {
  it('on another screen shows a toast; on the same job screen does nothing', () => {
    const other = make('11111111-1111-4111-8111-111111111111');
    other.h.onForeground(
      msg({ jobId: ID, tool: 't', status: 'completed' }, { title: 'Ready', body: 'Done' }),
    );
    expect(other.deps.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: ID, title: 'Ready', body: 'Done' }),
    );
    expect(other.deps.refresh).toHaveBeenCalledWith(ID);

    const same = make(ID);
    same.h.onForeground(ok);
    expect(same.deps.showToast).not.toHaveBeenCalled();
    expect(same.deps.route).not.toHaveBeenCalled();
    expect(same.deps.refresh).toHaveBeenCalledWith(ID);
  });

  it('toast Open routes to the job and tracks push_opened with app_state foreground', () => {
    const { deps, h } = make();
    h.onForeground(ok);
    deps.showToast.mock.calls[0][0].open();
    expect(deps.route).toHaveBeenCalledWith(`/(app)/job/${ID}`);
    expect(deps.trackOpened).toHaveBeenCalledWith({
      jobId: ID,
      tool: 'ai-upscale',
      status: 'completed',
      app_state: 'foreground',
    });
  });

  it('ignores a malformed message', () => {
    const { deps, h } = make();
    h.onForeground(msg({ jobId: 'nope' }));
    expect(deps.showToast).not.toHaveBeenCalled();
  });
});

describe('opened notification', () => {
  it('push_opened carries tool, status and app_state', () => {
    const { deps, h } = make();
    h.onOpened(ok, 'background');
    h.onOpened(msg({ jobId: ID, tool: 'video-compress', status: 'failed' }), 'quit');
    expect(deps.trackOpened.mock.calls).toEqual([
      [{ jobId: ID, tool: 'ai-upscale', status: 'completed', app_state: 'background' }],
      [{ jobId: ID, tool: 'video-compress', status: 'failed', app_state: 'quit' }],
    ]);
    expect(deps.route).toHaveBeenCalledWith(`/(app)/job/${ID}`);
  });

  it('invalid jobId routes to Tools and tracks nothing', () => {
    const { deps, h } = make();
    h.onOpened(msg({ jobId: 'bad' }), 'quit');
    expect(deps.route).toHaveBeenCalledWith('/(app)/(tabs)');
    expect(deps.trackOpened).not.toHaveBeenCalled();
  });
});

describe('route queue', () => {
  it('opened notification routes to /job/:id after the gate', () => {
    const navigate = jest.fn();
    const q = createRouteQueue(navigate);
    q.push(`/(app)/job/${ID}`);
    expect(navigate).not.toHaveBeenCalled();
    expect(q.pending()).toBe(`/(app)/job/${ID}`);
    q.setReady(true);
    expect(navigate).toHaveBeenCalledWith(`/(app)/job/${ID}`);
    expect(q.pending()).toBeNull();
    q.push('/(app)/(tabs)');
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('keeps only the latest queued tap and flushes once', () => {
    const navigate = jest.fn();
    const q = createRouteQueue(navigate);
    q.push('/a');
    q.push('/b');
    q.setReady(true);
    q.setReady(false);
    q.setReady(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/b');
  });
});
