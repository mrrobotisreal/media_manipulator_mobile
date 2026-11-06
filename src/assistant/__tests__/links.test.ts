import toolSlugs from '../__fixtures__/toolSlugs.json';
import {
  findToolBySlug,
  linkTargetKind,
  resolveAction,
  resolveSitePath,
  safeSitePath,
} from '../links';

describe('safeSitePath (link sanitising)', () => {
  it.each([
    ['/pricing', '/pricing'],
    ['/tools/compress-video', '/tools/compress-video'],
    ['https://media-manipulator.com/pricing', '/pricing'],
    ['https://www.media-manipulator.com/ru/pricing?x=1#a', '/pricing?x=1#a'],
    ['/uk/tools/compress-video', '/tools/compress-video'],
    ['/zh-tw/tools', '/tools'],
    ['http://www.media-manipulator.com/', '/'],
  ])('keeps %s as %s', (input, out) => {
    expect(safeSitePath(input)).toBe(out);
  });

  it.each([
    ['https://evil.example/pricing'],
    ['https://media-manipulator.com.evil.example/pricing'],
    ['//evil.example/x'],
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
    ['mailto:a@b.c'],
    ['intent://scan#Intent;end'],
    ['/api/account/me'],
    ['/dr/chat'],
    ['/embed/x'],
    ['/translator/x'],
    ['/ru/api/x'],
    ['/path with space'],
    ['/a\\b'],
    [''],
    [undefined],
    [null],
  ])('rejects %p', (input) => {
    expect(safeSitePath(input as string)).toBeNull();
  });
});

describe('linkTargetKind', () => {
  it.each([
    ['/pricing', 'pricing'],
    ['/ru/pricing', 'pricing'],
    ['/photo/new', 'editor'],
    ['/motion/new', 'editor'],
    ['/tools/content-studio', 'editor'],
    ['/tools/compress-video', 'tool'],
    ['/about', 'page'],
    ['/blog/video/video-compression-guide', 'page'],
  ])('%s is %s', (path, kind) => {
    expect(linkTargetKind(path)).toBe(kind);
  });
});

describe('findToolBySlug', () => {
  it('maps the web slug of an app row to the registry row', () => {
    expect(findToolBySlug('convert-video-to-animated-gif')?.tool.id).toBe('video-to-gif');
    expect(findToolBySlug('compress-video')?.tool.id).toBe('video-compress');
    expect(findToolBySlug('aperture')?.tool.id).toBe('aperture');
  });
  it('maps a preset slug to its row and preset', () => {
    const f = findToolBySlug('convert-audio-to-wav');
    expect(f?.tool.id).toBe('audio-convert');
    expect(f?.preset).toBe('wav');
  });
  it('returns null for a slug the phone does not have', () => {
    expect(findToolBySlug('voice-cloning')).toBeNull();
    expect(findToolBySlug('content-studio')).toBeNull();
    expect(findToolBySlug('medi')).toBeNull();
  });
  it('the API tool slugs split cleanly into phone tools and web fallbacks', () => {
    // Pinned from the API's routes.json (124 tool slugs): a registry change that loses coverage shows here.
    const phone = (toolSlugs as string[]).filter((s) => findToolBySlug(s) !== null);
    expect(phone.length).toBeGreaterThanOrEqual(85);
    for (const s of phone) {
      const r = resolveAction('open_tool', { slug: s }, 'en-US');
      expect(r?.kind).toBe('tool');
    }
  });
});

describe('resolveAction (action routing)', () => {
  it('open_tool for a known tool with a preset opens the tool screen with that preset', () => {
    const t = resolveAction(
      'open_tool',
      {
        slug: 'convert-video-to-animated-gif',
        route: '/tools/convert-video-to-animated-gif',
        preset: 'mp4-to-gif',
      },
      'en-US',
    );
    expect(t).toEqual({
      kind: 'tool',
      family: 'video',
      toolId: 'video-to-gif',
      preset: 'mp4-to-gif',
      href: '/(app)/tool/video/video-to-gif?from=medi&preset=mp4-to-gif',
    });
  });

  it('a preset the tool does not have is dropped, not forwarded', () => {
    const t = resolveAction('open_tool', { slug: 'compress-video', preset: 'nope' }, 'en-US');
    expect(t).toMatchObject({ kind: 'tool', toolId: 'video-compress', preset: undefined });
    expect((t as { href: string }).href).not.toContain('preset');
  });

  it('a preset slug as the tool slug applies that preset', () => {
    const t = resolveAction('open_tool', { slug: 'convert-audio-to-wav' }, 'en-US');
    expect(t).toMatchObject({ kind: 'tool', toolId: 'audio-convert', preset: 'wav' });
  });

  it('an unknown slug falls back to the site page in the user locale (Open on the web)', () => {
    expect(
      resolveAction('open_tool', { slug: 'voice-cloning', route: '/tools/voice-cloning' }, 'en-US'),
    ).toEqual({
      kind: 'web',
      url: 'https://www.media-manipulator.com/tools/voice-cloning',
    });
    expect(resolveAction('open_tool', { slug: 'voice-cloning' }, 'ru-RU')).toEqual({
      kind: 'web',
      url: 'https://www.media-manipulator.com/ru/tools/voice-cloning',
    });
  });

  it('an unusable slug yields no button', () => {
    expect(resolveAction('open_tool', { slug: '../../x' }, 'en-US')).toBeNull();
    expect(resolveAction('open_tool', {}, 'en-US')).toBeNull();
    expect(resolveAction('open_tool', null, 'en-US')).toBeNull();
  });

  it('confirm_job opens the tool (the phone does not run it in chat)', () => {
    expect(
      resolveAction('confirm_job', { tool: 'compress-video', family: 'video:compress' }, 'en-US'),
    ).toMatchObject({
      kind: 'tool',
      toolId: 'video-compress',
    });
  });

  it('navigate to an account page opens the matching Account screen; others go to the web', () => {
    expect(resolveAction('navigate', { target: '/account?tab=privacy' }, 'en-US')).toEqual({
      kind: 'route',
      href: '/(app)/(tabs)/account/privacy',
    });
    expect(resolveAction('navigate', { target: '/account' }, 'en-US')).toEqual({
      kind: 'route',
      href: '/(app)/(tabs)/account',
    });
    expect(resolveAction('navigate', { target: '/account?tab=history' }, 'en-US')).toEqual({
      kind: 'route',
      href: '/(app)/(tabs)/history',
    });
    expect(resolveAction('navigate', { target: '/delete-account' }, 'en-US')).toEqual({
      kind: 'route',
      href: '/(app)/(tabs)/account/delete-account',
    });
    expect(resolveAction('navigate', { target: '/tools' }, 'en-US')).toEqual({
      kind: 'route',
      href: '/(app)/(tabs)',
    });
    expect(resolveAction('navigate', { target: '/account?tab=billing' }, 'de-DE')).toEqual({
      kind: 'route',
      href: '/(app)/(tabs)/account',
    });
    expect(resolveAction('navigate', { target: '/pricing' }, 'de-DE')).toEqual({
      kind: 'web',
      url: 'https://www.media-manipulator.com/de/pricing',
    });
  });

  it('navigate refuses an off-site or non-path target', () => {
    expect(resolveAction('navigate', { target: 'https://evil.example/' }, 'en-US')).toBeNull();
    expect(resolveAction('navigate', { target: '/api/x' }, 'en-US')).toBeNull();
    expect(resolveAction('navigate', {}, 'en-US')).toBeNull();
  });

  it('copilot-only kinds have no phone target', () => {
    expect(resolveAction('heal', {}, 'en-US')).toBeNull();
    expect(resolveAction('export', {}, 'en-US')).toBeNull();
  });
});

describe('resolveSitePath', () => {
  it('opens Aperture for the editor route and the Tools tab for /tools', () => {
    expect(resolveSitePath('/photo/new', 'en-US')).toMatchObject({
      kind: 'tool',
      toolId: 'aperture',
    });
    expect(resolveSitePath('/tools', 'en-US')).toEqual({ kind: 'route', href: '/(app)/(tabs)' });
  });
  it('sends editors the phone lacks to the web', () => {
    expect(resolveSitePath('/motion/new', 'en-US')).toEqual({
      kind: 'web',
      url: 'https://www.media-manipulator.com/motion/new',
    });
    expect(resolveSitePath('/tools/content-studio', 'en-US')).toMatchObject({ kind: 'web' });
  });
});
