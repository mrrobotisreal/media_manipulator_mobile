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

/** What a form/builder may know about the file the job will run on, and the account's limits. */
export interface ToolInputInfo {
  /** Intake id and size (MA21): lets a form hand the same file to another tool. */
  id?: string;
  sizeBytes?: number;
  name: string;
  /** Local file:// URI (crop editor preview). */
  uri?: string;
  /** Lower-case, no dot. */
  extension: string;
  mime: string;
  mediaKind: MediaKind;
  /** Seconds (intake probe) for video/audio. */
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface ToolContext {
  input?: ToolInputInfo;
  limits?: { maxOutputHeight?: number };
}

export interface ToolFormProps<F = ToolOptions> {
  value: F;
  onChange: (next: F) => void;
  /** Additive (MA17): the first selected file and the cached account limits. */
  ctx?: ToolContext;
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
  /** Per-mode web slug (MA18); falls back to `analyticsSlug` when absent. */
  analyticsSlugFor?: (form: F) => string;
  /** MA10 ships identity builders (operation-identifying keys on web defaults); MA17-MA21 replace them. */
  optionsBuilder: (form: F, ctx?: ToolContext) => ToolOptions;
  /** Additive (MA17): a reason code when Run must stay disabled for this form state; null/absent = runnable. */
  blockReason?: (form: F, ctx?: ToolContext) => string | null;
  Form: ComponentType<ToolFormProps<F>>;
  /** Additive (MA21): i18n key for the Run button when it is not the generic `tool.start`. */
  startLabelKey?: string;
  /** Additive (MA21): the tool runs from its Form (inspect-metadata); the screen shows no Run button. */
  noRunButton?: boolean;
  /** null only for inspect-metadata (free, synchronous). */
  metric: QuotaMetric | null;
  gpu: boolean;
  analyticsSlug: string;
  /** The web `EmbeddedTask` (`embed.defaultTask`) of the row's slug; keys the result descriptor's `KIND_BY_TASK`. */
  webTask: string;
  keywords: string[];
  resultHint: ResultKind;
  minTier?: never;
  presets?: ToolPreset<F>[];
}

/** Erased form type for heterogeneous registries. */
export type AnyToolDefinition = ToolDefinition<any>;
