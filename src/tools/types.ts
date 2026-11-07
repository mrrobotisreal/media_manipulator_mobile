import type { IntakeFile } from '@/files/types';
import type { ComponentType } from 'react';

/** `voices` (MA34): the four Voices rows, their own Tools-tab section after AI (ticket said family `ai`; see TOOLS_V1 section 10). */
export type ToolFamily = 'image' | 'video' | 'audio' | 'ai' | 'voices' | 'metadata';
export const TOOL_FAMILIES: readonly ToolFamily[] = [
  'image',
  'video',
  'audio',
  'ai',
  'voices',
  'metadata',
];

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf';
export type QuotaMetric = 'ops' | 'ai_ops';

/**
 * 'auto' = presign for a video file, multipart upload otherwise (resolved by resolveTransport).
 * 'photoProject' (MA50) = the tool opens the Aperture editor, which creates a project
 * (`POST /photo/projects`) and exports through the `photoExport` job starter.
 */
export type ToolEndpoint = 'upload' | 'presign' | 'auto' | 'metadataInspect' | 'photoProject';
export type ResolvedTransport = 'upload' | 'presign' | 'metadataInspect' | 'photoProject';

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
  /**
   * Additive (Aperture launcher fix, 2026-11-04): the screen's selected files, so a form that
   * hands the file itself to another screen (Aperture) does not depend on the intake session,
   * which only share/intake fill. A photo picked on the tool screen is never in that session.
   */
  files?: readonly IntakeFile[];
}

export interface ToolFormProps<F = ToolOptions> {
  value: F;
  onChange: (next: F) => void;
  /** Additive (MA17): the first selected file and the cached account limits. */
  ctx?: ToolContext;
  /**
   * Additive (MA34): lets a Form hand the screen a file it made itself (the Voices recorder). The screen
   * adopts it exactly as if the user had picked it.
   */
  onFiles?: (files: IntakeFile[]) => void;
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
  /**
   * Additive (MA34): the registered job starter that creates the server job (`StartInput.starter`), for
   * tools whose request is not the plain `/upload` (the Voices convert / shift rows).
   */
  starter?: string;
  defaults: F;
  /** MA10 ships identity builders (operation-identifying keys on web defaults); MA17-MA21 replace them. */
  optionsBuilder: (form: F, ctx?: ToolContext) => ToolOptions;
  /** Additive (MA20): async step run before the options are built (face re-detect after the session expired). */
  prepare?: (form: F, ctx?: ToolContext) => Promise<F>;
  /** Additive (MA20): limits the server enforces for this tool, shown plainly on the form. */
  serverLimits?: { maxSeconds?: number; maxHeight?: number };
  /** Additive (MA17): a reason code when Run must stay disabled for this form state; null/absent = runnable. */
  blockReason?: (form: F, ctx?: ToolContext) => string | null;
  /** Per-mode web slug (MA18/MA19); falls back to the static `analyticsSlug`. */
  analyticsSlugFor?: (form: F, ctx?: ToolContext) => string;
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
  /**
   * Additive (MA50): a server capability the row needs; the Tools tab hides the row when the
   * capability is off (`useToolAvailability`). `photo` = `GET /photo/capabilities` enabled + render;
   * `photoHeal` (MA52, the Remove blemishes row) = `photo` and `heal`.
   */
  capability?: 'photo' | 'photoHeal' | VoiceCapability;
  /**
   * Additive (MA34): the Form owns its input (the Voices tools record or pick a sample themselves), so the
   * tool screen shows no file area and no "Accepts" line.
   */
  noFileArea?: boolean;
  /** Additive (MA34): never offered for shared/picked files (voice-design takes no file). */
  noIntake?: boolean;
}

/**
 * Additive (MA34): the Voices rows' server gates, read from `GET /voices/capabilities`
 * (`src/voices/gating.ts`). Hidden until the call has succeeded.
 */
export type VoiceCapability = 'voiceClone' | 'voiceDesign' | 'voiceChange' | 'voiceShift';

/** Erased form type for heterogeneous registries. */
export type AnyToolDefinition = ToolDefinition<any>;
