import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * HistoryRow and ProjectsList render their swipe actions on the physical LEFT in RTL. In RNGH 2.32
 * both action containers are `absoluteFill` siblings and the right one (drawn later, on top) still
 * caught touches while hidden, so "Delete" did nothing in Arabic/Hebrew. RNGH 2.33 fixed it with
 * `pointerEvents: 'none'` on the inactive container; `patches/react-native-gesture-handler+*.patch`
 * backports that. This fails if the patch stops applying (or the package moves past the version).
 */
const root = join(__dirname, '../../../node_modules/react-native-gesture-handler');
const files = [
  'src/components/ReanimatedSwipeable/ReanimatedSwipeable.tsx',
  'lib/module/components/ReanimatedSwipeable/ReanimatedSwipeable.js',
  'lib/commonjs/components/ReanimatedSwipeable/ReanimatedSwipeable.js',
];

describe('ReanimatedSwipeable RTL patch', () => {
  it.each(files)('%s lets touches through the hidden action container', (file) => {
    const src = readFileSync(join(root, file), 'utf8');
    expect(src).toContain("pointerEvents: showLeftProgress.value === 0 ? 'none' : 'auto'");
    expect(src).toContain("pointerEvents: showRightProgress.value === 0 ? 'none' : 'auto'");
  });
});
