/**
 * History's Projects segment model (ticket MA58 decision 1): Aperture, Darkroom and Motion
 * projects merged newest-first into one list, filtered by the chip row. Pure: no React, no I/O.
 */
import type { PhotoProject } from '@/api/schemas/photo';
import type { StudioProjectSummary } from '@/api/schemas/studio';
import type { VectorProjectSummary } from '@/api/schemas/vector';

export type ProjectProduct = 'aperture' | 'darkroom' | 'motion';
export type ProjectsFilter = 'all' | ProjectProduct;
export const PROJECT_FILTERS: readonly ProjectsFilter[] = ['all', 'aperture', 'darkroom', 'motion'];

export type ProjectRow =
  | { product: 'aperture'; key: string; at: number; project: PhotoProject }
  | { product: 'darkroom'; key: string; at: number; project: StudioProjectSummary }
  | { product: 'motion'; key: string; at: number; project: VectorProjectSummary };

const ms = (iso: string | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

export interface ProjectSources {
  aperture?: readonly PhotoProject[];
  darkroom?: readonly StudioProjectSummary[];
  motion?: readonly VectorProjectSummary[];
}

/** All rows newest first (last edit, else creation); ties keep source order (Aperture, Darkroom, Motion). */
export function mergeProjects(s: ProjectSources): ProjectRow[] {
  const rows: ProjectRow[] = [
    ...(s.aperture ?? []).map((p) => ({
      product: 'aperture' as const,
      key: `aperture:${p.id}`,
      at: ms(p.updatedAt ?? p.createdAt),
      project: p,
    })),
    ...(s.darkroom ?? []).map((p) => ({
      product: 'darkroom' as const,
      key: `darkroom:${p.id}`,
      at: ms(p.updatedAt ?? p.createdAt),
      project: p,
    })),
    ...(s.motion ?? []).map((p) => ({
      product: 'motion' as const,
      key: `motion:${p.id}`,
      at: ms(p.updatedAt ?? p.createdAt),
      project: p,
    })),
  ];
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.at - a.r.at || a.i - b.i)
    .map((x) => x.r);
}

export function filterRows(rows: readonly ProjectRow[], filter: ProjectsFilter): ProjectRow[] {
  return filter === 'all' ? [...rows] : rows.filter((r) => r.product === filter);
}

export function isProjectsFilter(v: unknown): v is ProjectsFilter {
  return typeof v === 'string' && (PROJECT_FILTERS as readonly string[]).includes(v);
}

/** Whether a project has captions (the export sheet offers the captions modes only then). */
export function studioHasCaptions(p: StudioProjectSummary): boolean {
  const cues = (p as { captions?: unknown }).captions;
  return Array.isArray(cues) && cues.length > 0;
}

/** The project's burned-in caption animation (analytics `captionAnimation`), or undefined. */
export function studioCaptionAnimation(p: StudioProjectSummary): string | undefined {
  const style = (p as { captionStyle?: { animation?: unknown } }).captionStyle;
  return typeof style?.animation === 'string' && style.animation ? style.animation : undefined;
}
