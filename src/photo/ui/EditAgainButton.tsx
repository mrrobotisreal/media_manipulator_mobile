/**
 * "Edit again" on an Aperture export's result screen (ticket MA52 decision 3): opens the export's
 * project in the editor (`/photo/<projectId>?from=history`) when the project still exists.
 */
import type { Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ConversionJob } from '@/api/schemas/job';
import { Button } from '@/ui/components/Button';
import { useEditAgain } from '../editAgain';
import { editorHref } from '../openRequest';

export function EditAgainButton({ job, toolSlug }: { job: ConversionJob; toolSlug?: string }) {
  const { t } = useTranslation();
  const state = useEditAgain(job);
  if (state.kind !== 'ready') return null;
  const open = () => {
    // Lazy: keeps expo-router out of tests that only render a result (ApertureLauncher's rule).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router } = require('expo-router') as typeof import('expo-router');
    router.push(editorHref(state.projectId, { from: 'history', slug: toolSlug }) as Href);
  };
  return (
    <Button
      testID="result-edit-again"
      variant="secondary"
      label={t('result.editAgain')}
      onPress={open}
    />
  );
}
