import type { Href } from 'expo-router';
import { openWebPage } from '@/account/openWeb';
import type { MediTarget } from './links';

export interface OpenDeps {
  push: (href: Href) => void;
  openWeb: (url: string) => Promise<void> | void;
}

/**
 * Opens a resolved Medi target: a tool screen / app route through the router, or the site page in
 * the in-app browser. Returns what happened, for analytics and tests.
 */
export function openTarget(target: MediTarget, deps: OpenDeps): 'tool' | 'route' | 'web' {
  if (target.kind === 'web') {
    void deps.openWeb(target.url);
    return 'web';
  }
  deps.push(target.href as Href);
  return target.kind;
}

export const realOpenWeb = (url: string) => openWebPage(url);
