/**
 * The `aperture` registry row's Form (ticket MA50 decision 9): the tool screen's FileArea picks the
 * photo (or it arrives from share-into / intake); this hands it to the editor in memory and opens
 * `/photo/new`. `noRunButton`: the editor runs itself. MA52's entry rows use the same launcher
 * (`apertureLauncherFor(slug)`): their form value `{panel, preset?}` (the row's `defaults`) rides
 * on the open request, and their web slug is the editor's `context.tool_slug`.
 */
import type { Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { PhotoEditorSource } from '@/analytics/events';
import { getIntakeFiles } from '@/files/session';
import type { ToolFormProps } from '@/tools/types';
import { isStripTool } from './stripTools';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { editorHref, NEW_PROJECT, setPhotoOpenRequest } from '../openRequest';
import { useGetPhotoCapabilitiesQuery } from '../projectsApi';
import { PHOTO_TOOL_SLUG } from '@/analytics/photoEvents';

export const PHOTO_BRAND = 'Aperture';

export function ApertureLauncher({
  ctx,
  value,
  slug = PHOTO_TOOL_SLUG,
}: ToolFormProps & { slug?: string }) {
  const { t } = useTranslation();
  const caps = useGetPhotoCapabilitiesQuery();
  const input = ctx?.input;
  const file = input?.id ? getIntakeFiles([input.id])[0] : undefined;
  const available = caps.data ? caps.data.enabled && caps.data.render !== false : true;
  const open = () => {
    if (!file) return;
    const source: PhotoEditorSource = file.source === 'share' ? 'app_share' : 'app_intake';
    const panel = isStripTool(value?.panel) ? value.panel : undefined;
    const preset = typeof value?.preset === 'string' ? value.preset : undefined;
    setPhotoOpenRequest({
      file,
      source,
      toolSlug: slug,
      ...(panel ? { panel } : {}),
      ...(preset ? { preset } : {}),
    });
    // Lazy: keeps expo-router out of every test that only imports the registry (InspectMetadataForm's rule).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router } = require('expo-router') as typeof import('expo-router');
    router.push(editorHref(NEW_PROJECT) as Href);
  };
  return (
    <View className="gap-3">
      <Text className="text-muted-fg">{t('photo.open.lead')}</Text>
      {!available ? (
        <Text className="text-sm text-subtle">
          {t('photo.unavailable', { brand: PHOTO_BRAND })}
        </Text>
      ) : null}
      <Button
        testID="photo-open-editor"
        label={t('photo.open.choose')}
        disabled={!file || !available}
        onPress={open}
      />
    </View>
  );
}

/** The Form of an MA52 entry row: the launcher reporting the row's web slug. */
export function apertureLauncherFor(slug: string) {
  function EntryLauncher(props: ToolFormProps) {
    return <ApertureLauncher {...props} slug={slug} />;
  }
  EntryLauncher.displayName = `ApertureLauncher(${slug})`;
  return EntryLauncher;
}
