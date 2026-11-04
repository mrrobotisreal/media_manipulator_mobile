/**
 * Presets (ticket MA51 decision 8; web `panels/presets-panel.tsx`): a horizontal strip of the
 * built-in looks with live 96 px thumbnails (the photo through the preset, rendered by the editor
 * on a 256 px downscale and cached per source), Auto (computed from the preview's histogram), and
 * "My presets" on this device (MMKV `photoPresets`): save the current stack, rename, delete, export
 * as JSON through the share sheet, import a JSON file. Applying appends the look as ONE group
 * ("Preset: <name>"); Undo removes it.
 */
import { Canvas, Image as SkiaImage, type SkImage } from '@shopify/react-native-skia';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { mmkvStorage } from '@/state/persist';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import { showNotice } from '@/ui/notice';
import { colors } from '@/ui/tokens';
import { presetLabel } from '../../history';
import type { AdjustmentLayer } from '../../photoTypes';
import {
  applyPreset,
  BUILTIN_PRESETS,
  builtinLayers,
  deleteUserPreset,
  exportPresetsJson,
  importPresetsJson,
  listUserPresets,
  renameUserPreset,
  saveUserPreset,
  type KvStorage,
  type UserPreset,
} from '../../presets/presetStore';
import { useEdit, useEditorTools, usePhotoSelector } from '../EditorContext';

export const PRESET_THUMB = 96;
const kvDefault = mmkvStorage as unknown as KvStorage;

function Thumb({ image, label }: { image: SkImage | null; label: string }) {
  return (
    <View style={{ width: PRESET_THUMB }} className="gap-1">
      <View
        style={{
          width: PRESET_THUMB,
          height: PRESET_THUMB,
          direction: 'ltr',
          backgroundColor: colors.surface2,
        }}
        className="overflow-hidden rounded-md"
      >
        {image ? (
          <Canvas style={{ width: PRESET_THUMB, height: PRESET_THUMB }}>
            <SkiaImage
              image={image}
              x={0}
              y={0}
              width={PRESET_THUMB}
              height={PRESET_THUMB}
              fit="cover"
            />
          </Canvas>
        ) : null}
      </View>
      <Text className="text-xs" numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

// i18n-keys: interface:photo.presets.name.color-pop-red, interface:photo.presets.name.color-pop-yellow, interface:photo.presets.name.color-pop-green, interface:photo.presets.name.color-pop-cyan, interface:photo.presets.name.color-pop-blue, interface:photo.presets.name.color-pop-magenta, interface:photo.presets.name.bw-film, interface:photo.presets.name.bw-high-contrast, interface:photo.presets.name.warm, interface:photo.presets.name.cool, interface:photo.presets.name.matte, interface:photo.presets.name.fade, interface:photo.presets.name.vivid, interface:photo.presets.name.punch, interface:photo.presets.name.cross-process, interface:photo.presets.name.vintage, interface:photo.presets.name.portrait-soften, interface:photo.presets.name.landscape, interface:photo.presets.name.auto
export function PresetsSheet({ kv = kvDefault }: { kv?: KvStorage }) {
  const { t } = useTranslation();
  const { edit } = useEdit();
  const x = useEditorTools();
  const doc = usePhotoSelector((s) => s.doc);
  const [mine, setMine] = useState<UserPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const reload = useCallback(async () => setMine(await listUserPresets(kv)), [kv]);
  useEffect(() => {
    let live = true;
    void listUserPresets(kv).then((l) => {
      if (live) setMine(l);
    });
    return () => {
      live = false;
    };
  }, [kv]);

  const nameOf = (id: string) => t(`interface:photo.presets.name.${id}`);
  const apply = (
    id: string,
    layers: AdjustmentLayer[] | null,
    display: string,
    builtin: boolean,
  ) => {
    if (!layers || layers.length === 0) return;
    edit(presetLabel(builtin, builtin ? id : display), (d) => applyPreset(d, id, layers, display));
    x.onPresetApplied?.(builtin ? id : 'custom', builtin);
  };

  const save = async () => {
    const n = name.trim();
    if (!n || !doc || doc.layers.length === 0) return;
    const p = await saveUserPreset(kv, { name: n, layers: doc.layers });
    if (!p) return showNotice(t('photo.presets.saveFailed'), 'error');
    setSaving(false);
    setName('');
    await reload();
    showNotice(t('photo.presets.saved'));
  };

  const doRename = async (id: string) => {
    if (await renameUserPreset(kv, id, name)) {
      setRenaming(null);
      setName('');
      await reload();
    }
  };

  const exportAll = async () => {
    if (mine.length === 0) return;
    const f = new File(Paths.cache, 'aperture-presets.json');
    if (f.exists) f.delete();
    f.create();
    f.write(exportPresetsJson(mine));
    await Sharing.shareAsync(f.uri, {
      mimeType: 'application/json',
      dialogTitle: t('interface:photo.presets.export'),
    });
  };

  const importFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    let text = '';
    try {
      text = await new File(res.assets[0].uri).text();
    } catch {
      return showNotice(t('interface:photo.presets.importError.json'), 'error');
    }
    const r = await importPresetsJson(kv, text);
    if (!r.ok) return showNotice(t(`interface:photo.presets.importError.${r.reason}`), 'error');
    await reload();
    showNotice(t('interface:photo.presets.imported'));
  };

  const hist = x.histogram256?.() ?? null;
  return (
    <View className="gap-4" testID="photo-presets-sheet">
      <Text className="text-sm text-muted-fg">{t('interface:photo.presets.appendNote')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3"
      >
        {BUILTIN_PRESETS.map((p) => {
          const layers = builtinLayers(p.id, hist);
          return (
            <Pressable
              key={p.id}
              testID={`photo-preset-${p.id}`}
              accessibilityRole="button"
              accessibilityLabel={nameOf(p.id)}
              disabled={!layers}
              onPress={() => apply(p.id, layers, nameOf(p.id), true)}
            >
              <Thumb
                image={layers ? (x.presetThumb?.(p.id, layers) ?? null) : null}
                label={nameOf(p.id)}
              />
            </Pressable>
          );
        })}
      </ScrollView>

      <View className="gap-2">
        <Text className="font-semibold">{t('interface:photo.presets.mine')}</Text>
        <Text className="text-sm text-muted-fg">{t('photo.presets.deviceNote')}</Text>
        {mine.length === 0 ? (
          <Text className="text-sm text-muted-fg">{t('interface:photo.presets.noneYet')}</Text>
        ) : (
          mine.map((p) => (
            <View
              key={p.id}
              className="gap-1 rounded-md border border-edge p-2"
              testID={`photo-user-preset-${p.id}`}
            >
              {renaming === p.id ? (
                <>
                  <TextField
                    label={t('interface:photo.presets.nameLabel')}
                    value={name}
                    onChangeText={setName}
                    maxLength={60}
                  />
                  <Button
                    label={t('interface:photo.presets.save')}
                    onPress={() => void doRename(p.id)}
                  />
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => apply(p.id, p.layers, p.name, false)}
                >
                  <Text className="font-semibold">{p.name}</Text>
                  <Text className="text-xs text-muted-fg">
                    {t('interface:photo.presets.layerCount', { count: p.layers.length })}
                  </Text>
                </Pressable>
              )}
              <View className="flex-row flex-wrap gap-2">
                <Button
                  variant="secondary"
                  label={t('interface:photo.presets.rename')}
                  onPress={() => {
                    setRenaming(p.id);
                    setName(p.name);
                  }}
                />
                <Button
                  variant="secondary"
                  label={t('interface:photo.presets.delete')}
                  onPress={async () => {
                    await deleteUserPreset(kv, p.id);
                    await reload();
                  }}
                />
              </View>
            </View>
          ))
        )}
        {saving ? (
          <View className="gap-2">
            <TextField
              testID="photo-preset-name"
              label={t('interface:photo.presets.nameLabel')}
              placeholder={t('interface:photo.presets.namePlaceholder')}
              value={name}
              onChangeText={setName}
              maxLength={60}
            />
            <View className="flex-row flex-wrap gap-2">
              <Button
                testID="photo-preset-save"
                label={t('interface:photo.presets.save')}
                onPress={() => void save()}
                disabled={!name.trim()}
              />
              <Button
                variant="secondary"
                label={t('interface:photo.presets.cancel')}
                onPress={() => setSaving(false)}
              />
            </View>
          </View>
        ) : (
          <Button
            testID="photo-preset-save-current"
            variant="secondary"
            label={t('interface:photo.presets.saveCurrent')}
            disabled={!doc || doc.layers.length === 0}
            onPress={() => setSaving(true)}
          />
        )}
        <View className="flex-row flex-wrap gap-2">
          <Button
            testID="photo-preset-import"
            variant="secondary"
            label={t('interface:photo.presets.import')}
            onPress={() => void importFile()}
          />
          <Button
            testID="photo-preset-export"
            variant="secondary"
            label={t('interface:photo.presets.export')}
            disabled={mine.length === 0}
            onPress={() => void exportAll()}
          />
        </View>
      </View>
    </View>
  );
}
