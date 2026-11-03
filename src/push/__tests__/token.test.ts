import { createTokenManager, type TokenDeps } from '../token';

const SECRET = 'fcm-secret-token-123';

function make(over: Partial<TokenDeps> = {}) {
  const calls: string[] = [];
  const deps: TokenDeps = {
    permission: async () => 'granted',
    getToken: async () => SECRET,
    deleteToken: async () => void calls.push('deleteToken'),
    register: jest.fn(async () => 'ok' as const),
    unregister: async () => void calls.push('unregister'),
    platform: () => 'android',
    appVersion: () => '1.0.0+7',
    locale: () => 'de-DE',
    ...over,
  };
  return { deps, calls, mgr: createTokenManager(deps) };
}

describe('push token lifecycle', () => {
  it('registers the token after sync with platform, appVersion and locale', async () => {
    const { deps, mgr } = make();
    expect(await mgr.sync()).toBe('registered');
    expect(deps.register).toHaveBeenCalledWith({
      token: SECRET,
      platform: 'android',
      appVersion: '1.0.0+7',
      locale: 'de-DE',
    });
  });

  it('does not register without OS permission or a token', async () => {
    const a = make({ permission: async () => 'denied' });
    expect(await a.mgr.sync()).toBe('skipped');
    const b = make({ getToken: async () => null });
    expect(await b.mgr.sync()).toBe('skipped');
    expect(a.deps.register).not.toHaveBeenCalled();
    expect(b.deps.register).not.toHaveBeenCalled();
  });

  it('409 account_not_synced asks for a retry after the next sync', async () => {
    const { mgr } = make({ register: async () => 'not_synced' });
    expect(await mgr.sync()).toBe('retry');
  });

  it('re-registers on token refresh and on locale change', async () => {
    let locale = 'en-US';
    const { deps, mgr } = make({ locale: () => locale });
    await mgr.sync();
    await mgr.onRefresh('rotated-token');
    locale = 'ja-JP';
    await mgr.sync();
    const reg = deps.register as jest.Mock;
    expect(reg.mock.calls.map((c) => [c[0].token, c[0].locale])).toEqual([
      [SECRET, 'en-US'],
      ['rotated-token', 'en-US'],
      [SECRET, 'ja-JP'],
    ]);
  });

  it('a refresh without permission does not register', async () => {
    const { deps, mgr } = make({ permission: async () => 'denied' });
    expect(await mgr.onRefresh('x')).toBe('skipped');
    expect(deps.register).not.toHaveBeenCalled();
  });

  it('release deletes the server token before deleteToken and never blocks', async () => {
    const { calls, mgr } = make();
    await mgr.sync();
    await mgr.release({ server: true });
    expect(calls).toEqual(['unregister', 'deleteToken']);
    expect(mgr.hasToken()).toBe(false);

    const failing = make({
      unregister: async () => {
        throw new Error('offline');
      },
      deleteToken: async () => {
        throw new Error('x');
      },
    });
    await expect(failing.mgr.release({ server: true })).resolves.toBeUndefined();

    const hung = make({ unregister: () => new Promise(() => undefined), signOutTimeoutMs: 20 });
    await expect(hung.mgr.release({ server: true })).resolves.toBeUndefined();
  });

  it('release without the server (deleted account / expired session) only deletes the device token', async () => {
    const { calls, mgr } = make();
    await mgr.release({ server: false });
    expect(calls).toEqual(['deleteToken']);
  });

  it('the token never appears in a console call', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { mgr } = make({ register: async () => 'failed' });
    await mgr.sync();
    await mgr.release({ server: true });
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(SECRET);
    spies.forEach((s) => s.mockRestore());
  });
});
