import { usePathname, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import { setScreen } from './context';
import { EVENTS, type ScreenViewedProps } from './events';

/** The Tools tab is the `(tabs)` index route. */
const ALIASES: Record<string, string> = { '/': '/tools' };

/**
 * Route segments -> the screen pattern (**proposed**): group segments `(…)` are dropped, dynamic
 * segments stay `[param]` (Expo Router reports them that way), so a pattern never holds an id:
 * `['(app)', 'tool', '[family]', '[toolId]']` -> `/tool/[family]/[toolId]`.
 */
export function screenPattern(segments: readonly string[]): string {
  const kept = segments.filter((s) => s && !/^\(.*\)$/.test(s) && s !== 'index');
  const path = `/${kept.join('/')}`;
  return ALIASES[path] ?? path;
}

/** `screen_viewed` once per distinct consecutive pattern (root layout). */
export function useScreenTracking(
  track: (name: typeof EVENTS.SCREEN_VIEWED, props: ScreenViewedProps) => void,
): void {
  const pathname = usePathname();
  const segments = useSegments();
  const last = useRef<string | null>(null);
  const pattern = screenPattern(segments);
  useEffect(() => {
    if (pattern === last.current) return;
    last.current = pattern;
    setScreen(pattern);
    track(EVENTS.SCREEN_VIEWED, { screen: pattern });
  }, [pattern, pathname, track]);
}
