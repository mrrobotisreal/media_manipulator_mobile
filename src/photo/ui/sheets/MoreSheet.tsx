/**
 * More (design §5.1): colour balance ×9, channel mixer, photo filter, split tone, LUT (.cube via
 * the document picker, ≤ 1 MB) and effects (invert, posterize, threshold, gamma). Each group is a
 * collapsible section so the sheet stays short on a phone.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Swatches } from '@/ui/components/Swatches';
import { Text } from '@/ui/components/Text';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { showNotice } from '@/ui/notice';
import {
  addLayer,
  layerOfType,
  nestedOf,
  paramOf,
  setFlag,
  setNested,
  setParam,
} from '../../edits';
import { removeLayer } from '../../layerOps';
import { parseLutCached } from '../../colorMath';
import { PHOTO_MAX_LUT_BYTES, type LayerType } from '../../photoTypes';
import { useEdit, usePhotoSelector } from '../EditorContext';
import { ParamSlider } from '../ParamSlider';

const FILTER_COLORS = ['#ec8a00', '#0a5dc8', '#704214', '#e02020', '#20a040', '#2040e0'] as const;

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-2 border-b border-edge pb-2">
      <Pressable
        testID={`photo-more-${id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text className="font-semibold">{title}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

// i18n-keys: interface:photo.colorBalance.shadows, interface:photo.colorBalance.midtones, interface:photo.colorBalance.highlights, interface:photo.colorBalance.r, interface:photo.colorBalance.g, interface:photo.colorBalance.b, interface:photo.channelMixer.out.r, interface:photo.channelMixer.out.g, interface:photo.channelMixer.out.b, interface:photo.channelMixer.r, interface:photo.channelMixer.g, interface:photo.channelMixer.b, interface:photo.channelMixer.constant
export function MoreSheet() {
  const { t } = useTranslation();
  const doc = usePhotoSelector((s) => s.doc);
  const { edit } = useEdit();
  const slider = (
    type: LayerType,
    path: [string, string] | string,
    label: string,
    min: number,
    max: number,
    def: number,
    step = 1,
  ) => {
    const key = Array.isArray(path) ? path.join('.') : path;
    return (
      <ParamSlider
        key={`${type}.${key}`}
        testID={`photo-${type}-${key}`}
        label={label}
        value={Array.isArray(path) ? nestedOf(doc, type, path, def) : paramOf(doc, type, path, def)}
        min={min}
        max={max}
        step={step}
        defaultValue={def}
        undoLabel={type}
        onValue={(v) =>
          edit(
            type,
            (d) => (Array.isArray(path) ? setNested(d, type, path, v) : setParam(d, type, path, v)),
            [type, key],
          )
        }
      />
    );
  };

  const pickLut = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    if ((asset.size ?? 0) > PHOTO_MAX_LUT_BYTES)
      return showNotice(t('photo.more.lutTooBig'), 'error');
    let text = '';
    try {
      text = await new File(asset.uri).text();
    } catch {
      return showNotice(t('photo.more.lutInvalid'), 'error');
    }
    if (text.length > PHOTO_MAX_LUT_BYTES) return showNotice(t('photo.more.lutTooBig'), 'error');
    if (!parseLutCached(text)) return showNotice(t('photo.more.lutInvalid'), 'error');
    edit('lut', (d) => setFlag(d, 'lut', 'cube', text), ['lut', 'cube']);
    showNotice(t('interface:photo.lut.loaded'));
  };

  const mixer = layerOfType(doc, 'channelMixer');
  const filter = layerOfType(doc, 'photoFilter');
  const lut = layerOfType(doc, 'lut');
  const has = (type: LayerType) => !!doc?.layers.some((l) => l.type === type);
  const toggleEffect = (type: LayerType) =>
    edit(
      type,
      (d) => {
        const l = layerOfType(d, type);
        return l ? removeLayer(d, l.id) : addLayer(d, type);
      },
      [type, 'enabled'],
    );

  return (
    <View className="gap-1">
      <Section id="colorBalance" title={t('interface:photo.colorBalance.title')}>
        {(['shadows', 'midtones', 'highlights'] as const).map((tone) => (
          <View key={tone} className="gap-1">
            <Text className="text-sm text-muted-fg">
              {t(`interface:photo.colorBalance.${tone}`)}
            </Text>
            {(['r', 'g', 'b'] as const).map((c) =>
              slider(
                'colorBalance',
                [tone, c],
                t(`interface:photo.colorBalance.${c}`),
                -100,
                100,
                0,
              ),
            )}
          </View>
        ))}
        <ToggleRow
          label={t('interface:photo.colorBalance.preserveLuminosity')}
          value={layerOfType(doc, 'colorBalance')?.params.preserveLuminosity ?? true}
          onChange={(v) =>
            edit('colorBalance', (d) => setFlag(d, 'colorBalance', 'preserveLuminosity', v))
          }
        />
      </Section>

      <Section id="channelMixer" title={t('interface:photo.channelMixer.title')}>
        {(['r', 'g', 'b'] as const).map((out) => (
          <View key={out} className="gap-1">
            <Text className="text-sm text-muted-fg">
              {t(`interface:photo.channelMixer.out.${out}`)}
            </Text>
            {(['r', 'g', 'b', 'constant'] as const).map((src) =>
              slider(
                'channelMixer',
                [out, src],
                t(`interface:photo.channelMixer.${src}`),
                -200,
                200,
                src === out ? 100 : 0,
              ),
            )}
          </View>
        ))}
        <ToggleRow
          label={t('interface:photo.channelMixer.monochrome')}
          value={mixer?.params.monochrome ?? false}
          onChange={(v) => edit('channelMixer', (d) => setFlag(d, 'channelMixer', 'monochrome', v))}
        />
      </Section>

      <Section id="photoFilter" title={t('interface:photo.photoFilter.title')}>
        <Swatches
          value={filter?.params.color ?? '#ec8a00'}
          colors={FILTER_COLORS}
          onChange={(hex) =>
            edit('photoFilter', (d) => setFlag(d, 'photoFilter', 'color', hex.toLowerCase()), [
              'photoFilter',
              'color',
            ])
          }
        />
        {slider('photoFilter', 'density', t('interface:photo.photoFilter.density'), 0, 100, 25)}
        <ToggleRow
          label={t('interface:photo.photoFilter.preserveLuminosity')}
          value={filter?.params.preserveLuminosity ?? true}
          onChange={(v) =>
            edit('photoFilter', (d) => setFlag(d, 'photoFilter', 'preserveLuminosity', v))
          }
        />
      </Section>

      <Section id="splitTone" title={t('interface:photo.splitTone.title')}>
        {(['shadows', 'highlights'] as const).map((end) => (
          <View key={end} className="gap-1">
            <Text className="text-sm text-muted-fg">{t(`interface:photo.splitTone.${end}`)}</Text>
            {slider('splitTone', [end, 'hue'], t('interface:photo.splitTone.hue'), 0, 360, 0)}
            {slider(
              'splitTone',
              [end, 'saturation'],
              t('interface:photo.splitTone.saturation'),
              0,
              100,
              0,
            )}
          </View>
        ))}
        {slider('splitTone', 'balance', t('interface:photo.splitTone.balance'), -100, 100, 0)}
      </Section>

      <Section id="lut" title={t('interface:photo.lut.title')}>
        <Button
          variant="secondary"
          label={t('photo.more.lutPick')}
          onPress={() => void pickLut()}
        />
        {lut?.params.cube ? (
          <>
            {slider('lut', 'intensity', t('interface:photo.lut.intensity'), 0, 1, 1, 0.01)}
            <Button
              variant="ghost"
              label={t('interface:photo.lut.clear')}
              onPress={() => edit('lut', (d) => removeLayer(d, lut.id))}
            />
          </>
        ) : null}
      </Section>

      <Section id="effects" title={t('photo.more.effects')}>
        {(['invert', 'posterize', 'threshold', 'gamma'] as const).map((type) => (
          <ToggleRow
            key={type}
            label={t(`interface:photo.effects.${type}`)}
            value={has(type)}
            onChange={() => toggleEffect(type)}
          />
        ))}
        {has('posterize')
          ? slider('posterize', 'levels', t('interface:photo.effects.levels'), 2, 255, 4)
          : null}
        {has('threshold')
          ? slider('threshold', 'level', t('interface:photo.effects.level'), 0, 1, 0.5, 0.01)
          : null}
        {has('gamma')
          ? slider('gamma', 'gamma', t('interface:photo.effects.gamma'), 0.1, 10, 1, 0.05)
          : null}
      </Section>
    </View>
  );
}
