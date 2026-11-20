/**
 * Starts a Darkroom render through the job engine's `studioExport` starter (MA58) and returns the
 * local job id; the caller opens `/(app)/job/<id>` (MA12 progress, MA13 result, MA16 sheets).
 */
import { getJobEngine } from '@/jobs/runtime';
import {
  DARKROOM_EXPORT_TOOL,
  STUDIO_EXPORT_STARTER,
  studioExportSource,
  type StudioExportJobOptions,
} from '@/jobs/starters/studioExport';
import { mmApi } from '@/api/mmApi';
import { store } from '@/state/store';

export function startStudioExportJob(args: {
  options: Omit<StudioExportJobOptions, 'tool'>;
  fileName: string;
  ext: string;
  mime: string;
  audioOnly: boolean;
}): string | undefined {
  const options: StudioExportJobOptions = { tool: 'studio_export', ...args.options };
  const ids = getJobEngine().startJobs([
    {
      tool: DARKROOM_EXPORT_TOOL,
      file: studioExportSource({
        projectId: options.projectId,
        fileName: args.fileName,
        ext: args.ext,
        mime: args.mime,
        audioOnly: args.audioOnly,
      }),
      starter: STUDIO_EXPORT_STARTER,
      options,
    },
  ]);
  store.dispatch(mmApi.util.invalidateTags(['History']));
  return ids[0];
}
