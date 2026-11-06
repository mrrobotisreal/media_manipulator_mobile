import { locales } from '@/i18n/locales';
import { webUrl, WEB_BASE_URL } from '@/lib/webUrl';
import { TOOLS } from '@/tools/registry';
import type { AnyToolDefinition } from '@/tools/types';
import type { AssistantLinkTargetProp } from '@/analytics/events';

/**
 * Link and action safety for Medi answers (ticket MA54 decisions 2 and 4; web `lib/assistant/links.ts`).
 * Model text can name any URL; only same-site paths survive. A surviving path, and every `open_tool` /
 * `navigate` action, is resolved to where it goes on the phone:
 *
 *  - `tool`  a registry row, optionally with one of its presets
 *  - `route` an in-app route (an Account screen, the History or Tools tab)
 *  - `web`   the site page, opened in the in-app browser (unknown tools, pricing, legal, blog...)
 */
export type MediTarget =
  | { kind: 'tool'; family: string; toolId: string; preset?: string; href: string }
  | { kind: 'route'; href: string }
  | { kind: 'web'; url: string };

const SITE_HOSTS = new Set(['media-manipulator.com', 'www.media-manipulator.com']);
const BLOCKED_PREFIXES = ['/api', '/dr', '/embed', '/translator'];
const LOCALE_PREFIXES = new Set(locales.map((l) => l.prefix).filter((p) => p !== 'en'));

function ownHost(): string {
  try {
    return new URL(WEB_BASE_URL).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Drops a leading web locale prefix (`/ru/pricing` -> `/pricing`). */
export function stripLocalePrefix(pathname: string): string {
  const m = /^\/([a-z]{2}(?:-[a-z]{2})?)(?=\/|$)/i.exec(pathname);
  if (m && LOCALE_PREFIXES.has(m[1]!.toLowerCase())) return pathname.slice(m[0].length) || '/';
  return pathname;
}

/**
 * A safe, locale-free site path (`/path?query#hash`) from model text, or null (render as text).
 * Accepts `/path`, `https://(www.)media-manipulator.com/path` and the configured web origin; rejects
 * other hosts, protocol-relative `//x`, `javascript:` and anything that is not http(s) or a path.
 */
export function safeSitePath(href: string | undefined | null): string | null {
  if (!href) return null;
  const raw = href.trim();
  let path: string;
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    path = raw;
  } else {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    if (!SITE_HOSTS.has(host) && host !== ownHost()) return null;
    path = `${url.pathname}${url.search}${url.hash}`;
  }
  if (/[\s\\]/.test(path)) return null;
  const pathname = stripLocalePrefix(path.split(/[?#]/)[0] || '/');
  if (BLOCKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  const rest = path.slice((path.split(/[?#]/)[0] || '/').length);
  return pathname + rest;
}

/** What kind of page a site path is, for `assistant_link_clicked.target_kind`. */
export function linkTargetKind(path: string): AssistantLinkTargetProp {
  const p = stripLocalePrefix(path.split(/[?#]/)[0] || '/');
  if (p === '/pricing' || p.startsWith('/pricing/')) return 'pricing';
  if (
    p === '/motion' ||
    p.startsWith('/motion/') ||
    p === '/photo' ||
    p.startsWith('/photo/') ||
    p === '/tools/content-studio'
  ) {
    return 'editor';
  }
  if (p.startsWith('/tools/')) return 'tool';
  return 'page';
}

// --- Tool resolution ------------------------------------------------------------------------------

interface ToolIndex {
  byAnalyticsSlug: Map<string, AnyToolDefinition>;
  byPreset: Map<string, { tool: AnyToolDefinition; preset: string }>;
}

let index: ToolIndex | null = null;
function toolIndex(): ToolIndex {
  if (index) return index;
  const byAnalyticsSlug = new Map<string, AnyToolDefinition>();
  const byPreset = new Map<string, { tool: AnyToolDefinition; preset: string }>();
  for (const tool of TOOLS) {
    if (!byAnalyticsSlug.has(tool.analyticsSlug)) byAnalyticsSlug.set(tool.analyticsSlug, tool);
    for (const p of tool.presets ?? []) {
      if (!byPreset.has(p.id)) byPreset.set(p.id, { tool, preset: p.id });
      if (!byPreset.has(p.analyticsSlug)) byPreset.set(p.analyticsSlug, { tool, preset: p.id });
    }
  }
  index = { byAnalyticsSlug, byPreset };
  return index;
}

/**
 * The registry row behind a web tool slug (`convert-video-to-animated-gif`), and the preset the slug
 * itself names (`convert-audio-to-wav` -> audio-convert + `wav`). Null when the phone has no such tool
 * (Darkroom, Motion, voices, transcoding, ...).
 */
export function findToolBySlug(slug: string): { tool: AnyToolDefinition; preset?: string } | null {
  const i = toolIndex();
  const direct = i.byAnalyticsSlug.get(slug);
  if (direct) return { tool: direct };
  const viaPreset = i.byPreset.get(slug);
  return viaPreset ? { tool: viaPreset.tool, preset: viaPreset.preset } : null;
}

export function toolTarget(tool: AnyToolDefinition, preset?: string): MediTarget {
  const valid = preset && tool.presets?.some((p) => p.id === preset) ? preset : undefined;
  const q = `from=medi${valid ? `&preset=${encodeURIComponent(valid)}` : ''}`;
  return {
    kind: 'tool',
    family: tool.family,
    toolId: tool.id,
    preset: valid,
    href: `/(app)/tool/${tool.family}/${tool.id}?${q}`,
  };
}

const TABS = '/(app)/(tabs)';
const ACCOUNT = `${TABS}/account`;

/** Resolves a safe site path (see `safeSitePath`) to where it goes on the phone. */
export function resolveSitePath(path: string, localeCode: string): MediTarget {
  const [pathAndQuery = '/'] = path.split('#');
  const [pathname = '/', query = ''] = pathAndQuery.split('?');
  const params = new URLSearchParams(query);
  const web = (): MediTarget => ({
    kind: 'web',
    url: webUrl(pathname + (query ? `?${query}` : ''), localeCode),
  });

  const tool = /^\/tools\/([a-z0-9][a-z0-9-]*)$/.exec(pathname);
  if (tool) {
    const slug = tool[1]!;
    const found = findToolBySlug(slug);
    if (!found) return web();
    return toolTarget(found.tool, params.get('preset') ?? found.preset);
  }
  switch (pathname) {
    case '/tools':
      return { kind: 'route', href: TABS };
    case '/photo/new': {
      const aperture = findToolBySlug('aperture');
      return aperture ? toolTarget(aperture.tool) : web();
    }
    case '/account': {
      const tab = params.get('tab');
      if (tab === 'privacy') return { kind: 'route', href: `${ACCOUNT}/privacy` };
      if (tab === 'history' || tab === 'projects')
        return { kind: 'route', href: `${TABS}/history` };
      return { kind: 'route', href: ACCOUNT };
    }
    case '/delete-account':
      return { kind: 'route', href: `${ACCOUNT}/delete-account` };
    default:
      return web();
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const PRESET_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Where an `open_tool` / `confirm_job` / `navigate` action goes. Null when the params are unusable
 * (the button is then hidden). `open_tool {slug, route?, preset?}`: a registry row opens the tool
 * screen with the preset; an unknown slug falls back to the site page ("Open on the web").
 * `options` (MM116a prefill) is not carried: the phone's forms have no URL codec.
 */
export function resolveAction(
  kind: string,
  params: Record<string, unknown> | null | undefined,
  localeCode: string,
): MediTarget | null {
  const p = params ?? {};
  if (kind === 'navigate') {
    const safe = typeof p.target === 'string' ? safeSitePath(p.target) : null;
    return safe ? resolveSitePath(safe, localeCode) : null;
  }
  if (kind === 'open_tool' || kind === 'confirm_job') {
    const raw = kind === 'confirm_job' ? p.tool : p.slug;
    const slug = typeof raw === 'string' && SLUG_RE.test(raw) ? raw : null;
    if (!slug) return null;
    const preset = typeof p.preset === 'string' && PRESET_RE.test(p.preset) ? p.preset : undefined;
    const found = findToolBySlug(slug);
    if (found) return toolTarget(found.tool, preset ?? found.preset);
    const route = typeof p.route === 'string' ? safeSitePath(p.route) : null;
    return resolveSitePath(route ?? `/tools/${slug}`, localeCode);
  }
  return null;
}
