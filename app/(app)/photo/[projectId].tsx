import { useLocalSearchParams } from 'expo-router';
import { parseSavedSource, parseSlugParam } from '@/photo/openRequest';
import { PhotoEditorScreen } from '@/photo/ui/PhotoEditorScreen';

/**
 * `/photo/new` (a file handed over in memory) or `/photo/<projectId>` (a saved project;
 * `?from=history|projects` and `?slug=` feed `photo_editor_opened`, MA52).
 */
export default function PhotoEditorRoute() {
  const { projectId, from, slug } = useLocalSearchParams<{
    projectId: string;
    from?: string;
    slug?: string;
  }>();
  return (
    <PhotoEditorScreen
      key={projectId}
      projectId={typeof projectId === 'string' ? projectId : 'new'}
      savedSource={parseSavedSource(from)}
      savedSlug={parseSlugParam(slug)}
    />
  );
}
