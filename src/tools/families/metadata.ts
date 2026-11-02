import { EditMetadataForm } from '../forms/metadata/EditMetadataForm';
import { InspectMetadataForm } from '../forms/metadata/InspectMetadataForm';
import { StripMetadataForm } from '../forms/metadata/StripMetadataForm';
import * as o from '../options/metadata';
import type { AnyToolDefinition } from '../types';
import {
  AUDIO_ACCEPTS,
  IMAGE_ACCEPTS,
  PDF_ACCEPTS,
  VIDEO_ACCEPTS,
  mergeAccepts,
  row,
} from './shared';

const seeded = [
  row({
    id: 'inspect-metadata',
    family: 'metadata',
    icon: 'FileSearch',
    accepts: mergeAccepts(IMAGE_ACCEPTS, VIDEO_ACCEPTS, AUDIO_ACCEPTS, PDF_ACCEPTS),
    endpoint: 'metadataInspect',
    defaults: {},
    metric: null,
    analyticsSlug: 'inspect-metadata',
    webTask: 'inspect_metadata',
    resultHint: 'metadata',
    keywords: ['inspect-metadata', 'exif', 'info', 'details', 'gps'],
  }),
  row({
    id: 'strip-metadata',
    family: 'metadata',
    icon: 'ShieldOff',
    accepts: mergeAccepts(IMAGE_ACCEPTS, VIDEO_ACCEPTS, AUDIO_ACCEPTS),
    endpoint: 'upload',
    defaults: o.STRIP_DEFAULTS,
    metric: 'ops',
    analyticsSlug: 'remove-exif-metadata',
    webTask: 'remove_metadata',
    resultHint: 'image',
    keywords: ['remove-exif-metadata', 'exif', 'privacy', 'gps', 'location'],
  }),
  row({
    id: 'edit-metadata',
    family: 'metadata',
    icon: 'Pencil',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: o.EDIT_DEFAULTS,
    metric: 'ops',
    analyticsSlug: 'edit-image-metadata',
    webTask: 'edit_image_metadata',
    resultHint: 'image',
    keywords: ['edit-image-metadata', 'exif', 'author', 'title', 'gps'],
  }),
];

const byId = (id: string) => seeded.find((t) => t.id === id)!;
const withForm = (
  base: AnyToolDefinition,
  extra: Partial<AnyToolDefinition>,
): AnyToolDefinition => ({
  ...base,
  ...extra,
});

export const metadataTools: AnyToolDefinition[] = [
  withForm(byId('inspect-metadata'), {
    Form: InspectMetadataForm,
    noRunButton: true,
    optionsBuilder: () => ({}),
  }),
  withForm(byId('strip-metadata'), {
    Form: StripMetadataForm,
    startLabelKey: 'tools.metadata.strip.stripEverything',
    optionsBuilder: o.buildStripOptions,
  }),
  withForm(byId('edit-metadata'), {
    Form: EditMetadataForm,
    startLabelKey: 'tools.metadata.edit.apply',
    optionsBuilder: o.buildEditOptions,
    blockReason: (form, ctx) =>
      o.editFormValid(form as o.EditMetadataForm) ? null : 'invalidLocation',
  }),
];
