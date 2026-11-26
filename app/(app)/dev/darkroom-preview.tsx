import { Redirect } from 'expo-router';
import { PreviewDevScreen } from '@/studio/mobile/ui/dev/PreviewDevScreen';

/**
 * DEVELOPMENT BUILDS ONLY (MA62 S4): `/dev/darkroom-preview` mounts `<StudioPreview>` on one of the
 * account's Darkroom projects. In a production or preview build `__DEV__` is false, so the route
 * redirects home and Metro drops the screen from the bundle's reachable code. No screen links here;
 * open it with `adb shell am start -a android.intent.action.VIEW -d
 * "mediamanipulator-dev://dev/darkroom-preview"` on a development build.
 */
export default function DarkroomPreviewDevRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <PreviewDevScreen />;
}
