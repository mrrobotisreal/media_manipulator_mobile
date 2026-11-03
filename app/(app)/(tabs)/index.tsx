import { useRouter, type Href } from 'expo-router';
import { ChevronRight, Search, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, ScrollView, SectionList, TextInput, View } from 'react-native';
import { AuthBanners } from '@/auth/ui/AuthBanners';
import { useAppSelector } from '@/state/hooks';
import { QuotaHeader } from '@/quota/QuotaHeader';
import { ToolIcon } from '@/tools/icons';
import { recentTools } from '@/tools/recents';
import { searchTools, type SearchableTool } from '@/tools/search';
import type { AnyToolDefinition } from '@/tools/types';
import { useSearchableTools } from '@/tools/useSearchableTools';
import { Screen } from '@/ui/components/Screen';
import { Text } from '@/ui/components/Text';
import { colors, hitTarget } from '@/ui/tokens';

// i18n-keys: tools.families.image, tools.families.video, tools.families.audio, tools.families.ai, tools.families.metadata
const SEARCH_DEBOUNCE_MS = 150;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function ToolsTab() {
  const { t } = useTranslation();
  const router = useRouter();
  const items = useSearchableTools();
  const lastToolIds = useAppSelector((s) => s.settings.lastToolIds);
  const [text, setText] = useState('');
  const query = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);
  const sections = useMemo(() => searchTools(items, query), [items, query]);
  const recents = useMemo(() => recentTools(lastToolIds), [lastToolIds]);

  const open = (tool: AnyToolDefinition, from: 'tools_tab' | 'search' | 'recents') =>
    router.push(`/(app)/tool/${tool.family}/${tool.id}?from=${from}` as Href);

  const header = (
    <View>
      <AuthBanners />
      <QuotaHeader />
      <View
        className="mx-4 mt-3 flex-row items-center rounded-md border border-edge-control bg-surface-1 px-3"
        style={{ minHeight: hitTarget }}
      >
        <Search size={18} color={colors.mutedFg} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('tools.search.placeholder')}
          placeholderTextColor={colors.subtle}
          testID="tools-search"
          accessibilityLabel={t('tools.search.placeholder')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          className="ms-2 flex-1 font-sans text-foreground"
          style={{ textAlign: 'auto', minHeight: hitTarget }}
        />
        {text.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('tools.search.clear')}
            onPress={() => setText('')}
            hitSlop={8}
          >
            <X size={18} color={colors.mutedFg} />
          </Pressable>
        ) : null}
      </View>
      {query === '' && recents.length > 0 ? (
        <View className="mt-3">
          <Text className="mx-4 mb-2 text-sm font-semibold text-muted-fg">
            {t('tools.recents')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2 px-4"
          >
            {recents.map((tool) => {
              return (
                <Pressable
                  key={tool.id}
                  accessibilityRole="button"
                  onPress={() => open(tool, 'recents')}
                  className="flex-row items-center gap-2 rounded-md border border-edge bg-surface-1 px-3"
                  style={{ minHeight: hitTarget }}
                >
                  <ToolIcon name={tool.icon} size={16} color={colors.data} />
                  <Text className="text-sm">{t(tool.titleKey)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );

  const renderRow = (item: SearchableTool) => {
    const { tool } = item;
    return (
      <Pressable
        testID={`tool-row-${tool.id}`}
        accessibilityRole="button"
        onPress={() => open(tool, query ? 'search' : 'tools_tab')}
        className="mx-4 mb-2 flex-row items-center gap-3 rounded-lg border border-edge bg-surface-1 px-3 py-2"
        style={{ minHeight: hitTarget }}
      >
        <ToolIcon name={tool.icon} size={22} color={colors.data} />
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="font-semibold" numberOfLines={1}>
              {item.title}
            </Text>
            {tool.metric === 'ai_ops' ? (
              <View className="rounded-sm bg-surface-3 px-1.5 py-0.5">
                <Text className="text-xs font-semibold text-premium">{t('tools.badge.ai')}</Text>
              </View>
            ) : null}
          </View>
          <Text className="text-sm text-muted-fg" numberOfLines={1}>
            {item.description}
          </Text>
        </View>
        <ChevronRight
          size={18}
          color={colors.subtle}
          style={{ transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] }}
        />
      </Pressable>
    );
  };

  return (
    <Screen edges="none">
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.tool.id}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderSectionHeader={({ section }) => (
          <Text className="mx-4 mb-2 mt-4 text-sm font-semibold uppercase text-muted-fg">
            {t(`tools.families.${section.family}`)}
          </Text>
        )}
        renderItem={({ item }) => renderRow(item)}
        ListEmptyComponent={
          <Text className="mx-4 mt-8 text-center text-muted-fg">
            {t('tools.search.empty', { query })}
          </Text>
        }
      />
    </Screen>
  );
}
