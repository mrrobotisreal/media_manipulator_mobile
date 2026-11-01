import type { ComponentType } from 'react';

export type ToolFamily = 'image' | 'video' | 'audio' | 'ai' | 'metadata';
export const TOOL_FAMILIES: readonly ToolFamily[] = ['image', 'video', 'audio', 'ai', 'metadata'];

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf';
export type QuotaMetric = 'ops' | 'ai_ops';

/** 'auto' = presign for a video file, multipart upload otherwise (resolved by resolveTransport). */
export type ToolEndpoint = 'upload' | 'presign' | 'auto' | 'metadataInspect';
export type ResolvedTransport = 'upload' | 'presign' | 'metadataInspect';

export type ResultKind =
  'image' | 'gif' | 'video' | 'audio' | 'pdf' | 'archive' | 'transcript' | 'metadata' | 'unknown';

export type ToolOptions = Record<string, unknown>;

/** What a form or builder may know about the picked file (the intake copy). */
export interface ToolFileInfo {
  /** Lower-case, no dot. */
  extension: string;
  durationSec?: number;
  width?: number;
  height?: number;
  /** file:// URI of the intake copy (previews and thumbnails only). */
  uri?: string;
}

/** Context handed to builders and validators beyond the form value. */
export interface ToolBuildContext {
  file?: ToolFileInfo;
  /** Cached tier limits; undefined while `/account/me` has not loaded (then nothing is gated). */
  limits?: { maxOutputHeight?: number };
}

export interface ToolFormProps<F = ToolOptions> {
  value: F;
  onChange: (next: F) => void;
  /** The picked file, when one is attached (forms read duration / size / extension from it). */
  file?: ToolFileInfo;
}

export interface ToolPreset<F = ToolOptions> {
  id: string;
  titleKey: string;
  analyticsSlug: string;
  defaults: Partial<F>;
}

export interface ToolAccepts {
  kinds: MediaKind[];
  mime: string[];
  /** Lower-case, no leading dot. */
  extensions: string[];
}

export interface ToolDefinition<F = ToolOptions> {
  id: string;
  family: ToolFamily;
  titleKey: string;
  descriptionKey: string;
  /** lucide-react-native component name. */
  icon: string;
  accepts: ToolAccepts;
  /** Multi-select in the pickers; default false (v1 runs one job per file, MA12 owns the queue). */
  batch?: boolean;
  endpoint: ToolEndpoint;
  defaults: F;
  /** MA10 ships identity builders (operation-identifying keys on web defaults); MA17-MA21 replace them. */
  optionsBuilder: (form: F, ctx?: ToolBuildContext) => ToolOptions;
  /** Run is disabled while this returns false; forms render their own reason. Absent = always valid. */
  isValid?: (form: F, ctx?: ToolBuildContext) => boolean;
  Form: ComponentType<ToolFormProps<F>>;
  /** null only for inspect-metadata (free, synchronous). */
  metric: QuotaMetric | null;
  gpu: boolean;
  analyticsSlug: string;
  /** Per-mode web slug (MA18 decision 9); falls back to `analyticsSlug` when absent. */
  analyticsSlugFor?: (form: F) => string;
  /** The web `EmbeddedTask` (`embed.defaultTask`) of the row's slug; keys the result descriptor's `KIND_BY_TASK`. */
  webTask: string;
  keywords: string[];
  resultHint: ResultKind;
  minTier?: never;
  presets?: ToolPreset<F>[];
}

/** Erased form type for heterogeneous registries. */
export type AnyToolDefinition = ToolDefinition<any>;
