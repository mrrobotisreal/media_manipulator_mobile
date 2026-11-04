/** The 64-bin histogram as Skia paths (RGB or one channel), with the Levels input handles marked. */
import { Canvas, Line, Path, Skia, vec } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { colors } from '@/ui/tokens';
import { HISTOGRAM_BINS, normaliseBins, type Histogram64 } from '../histogram';
import type { LevelsChannel } from '../photoTypes';

const CH: Record<'r' | 'g' | 'b' | 'luma', string> = {
  r: '#F4525C',
  g: '#4ADE80',
  b: '#5EA8FF',
  luma: colors.mutedFg,
};

function binsPath(bins: number[], w: number, h: number) {
  const p = Skia.Path.Make();
  p.moveTo(0, h);
  bins.forEach((v, i) => {
    const x = ((i + 0.5) / HISTOGRAM_BINS) * w;
    p.lineTo(x, h - v * h);
  });
  p.lineTo(w, h);
  p.close();
  return p;
}

export function HistogramView({
  histogram,
  channel = 'master',
  levels,
  height = 72,
}: {
  histogram: Histogram64 | null;
  channel?: LevelsChannel;
  levels?: { inBlack: number; inWhite: number };
  height?: number;
}) {
  const { t } = useTranslation();
  const [w, setW] = useState(0);
  const paths = useMemo(() => {
    if (!histogram || w <= 0) return [];
    const keys = channel === 'master' ? (['r', 'g', 'b'] as const) : ([channel] as const);
    return keys.map((k) => ({
      k,
      path: binsPath(normaliseBins(histogram[k], histogram.max), w, height),
    }));
  }, [histogram, channel, w, height]);
  return (
    <View
      accessibilityLabel={t('interface:photo.histogram.label')}
      style={{ height, direction: 'ltr' }}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      <Canvas style={{ flex: 1, backgroundColor: colors.surface2 }}>
        {paths.map(({ k, path }) => (
          <Path key={k} path={path} color={CH[k]} opacity={0.45} />
        ))}
        {levels ? (
          <>
            <Line
              p1={vec(levels.inBlack * w, 0)}
              p2={vec(levels.inBlack * w, height)}
              color={colors.foreground}
              strokeWidth={2}
            />
            <Line
              p1={vec(levels.inWhite * w, 0)}
              p2={vec(levels.inWhite * w, height)}
              color={colors.foreground}
              strokeWidth={2}
            />
          </>
        ) : null}
      </Canvas>
    </View>
  );
}
