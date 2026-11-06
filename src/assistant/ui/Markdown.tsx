import { Text as RNText, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { parseMarkdown, type Block, type Inline } from '../markdown';

/**
 * Medi's answer renderer. Link taps go to `onLink(href)`; the screen decides (and sanitises) where
 * they lead: a link that does not resolve to the site renders as plain text instead.
 */
export function Markdown({
  content,
  onLink,
  isSafeLink,
  testID,
}: {
  content: string;
  onLink: (href: string) => void;
  isSafeLink: (href: string) => boolean;
  testID?: string;
}) {
  const blocks = parseMarkdown(content);
  return (
    <View className="gap-2" testID={testID}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} onLink={onLink} isSafeLink={isSafeLink} />
      ))}
    </View>
  );
}

function Inlines({
  nodes,
  onLink,
  isSafeLink,
}: {
  nodes: Inline[];
  onLink: (href: string) => void;
  isSafeLink: (href: string) => boolean;
}) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.t === 'text') {
          const cls = `${n.bold ? 'font-semibold ' : ''}${n.italic ? 'italic' : ''}`;
          return (
            <RNText key={i} className={cls}>
              {n.text}
            </RNText>
          );
        }
        if (!isSafeLink(n.href)) {
          return <Inlines key={i} nodes={n.children} onLink={onLink} isSafeLink={isSafeLink} />;
        }
        return (
          <RNText
            key={i}
            accessibilityRole="link"
            className="text-primary underline"
            onPress={() => onLink(n.href)}
          >
            <Inlines nodes={n.children} onLink={onLink} isSafeLink={isSafeLink} />
          </RNText>
        );
      })}
    </>
  );
}

function BlockView({
  block,
  onLink,
  isSafeLink,
}: {
  block: Block;
  onLink: (href: string) => void;
  isSafeLink: (href: string) => boolean;
}) {
  if (block.t === 'p') {
    return (
      <Text className="leading-6">
        <Inlines nodes={block.inline} onLink={onLink} isSafeLink={isSafeLink} />
      </Text>
    );
  }
  const ordered = block.t === 'ol';
  return (
    <View className="gap-1">
      {block.items.map((item, i) => (
        <View key={i} className="flex-row gap-2">
          <Text className="w-6 text-end text-muted-fg">
            {ordered ? `${block.start + i}.` : '•'}
          </Text>
          <Text className="flex-1 leading-6">
            <Inlines nodes={item} onLink={onLink} isSafeLink={isSafeLink} />
          </Text>
        </View>
      ))}
    </View>
  );
}
