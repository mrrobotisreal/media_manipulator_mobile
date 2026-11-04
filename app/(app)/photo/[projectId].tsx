import { useLocalSearchParams } from 'expo-router';
import { PhotoEditorScreen } from '@/photo/ui/PhotoEditorScreen';

/** `/photo/new` (a file handed over in memory) or `/photo/<projectId>` (a saved project). */
export default function PhotoEditorRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return (
    <PhotoEditorScreen
      key={projectId}
      projectId={typeof projectId === 'string' ? projectId : 'new'}
    />
  );
}
