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

export interface ToolFormProps<F = ToolOptions> {
  value: F;
  onChange: (next: F) => void;
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
  endpoint: ToolEndpoint;
  defaults: F;
  /** MA10 ships identity builders (operation-identifying keys on web defaults); MA17-MA21 replace them. */
  optionsBuilder: (form: F) => ToolOptions;
  Form: ComponentType<ToolFormProps<F>>;
  /** null only for inspect-metadata (free, synchronous). */
  metric: QuotaMetric | null;
  gpu: boolean;
  analyticsSlug: string;
  keywords: string[];
  resultHint: ResultKind;
  minTier?: never;
  presets?: ToolPreset<F>[];
}

/** Erased form type for heterogeneous registries. */
export type AnyToolDefinition = ToolDefinition<any>;
