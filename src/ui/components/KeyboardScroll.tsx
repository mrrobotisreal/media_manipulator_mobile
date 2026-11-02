import { useEffect, useRef, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
  type ScrollViewProps,
} from 'react-native';

/** Room kept under the focused field so the next control (the submit button) stays visible too. */
const ROOM_BELOW_FOCUSED = 120;

/**
 * A ScrollView that stays usable with the keyboard open. Android 15+ draws edge-to-edge, so the window
 * no longer resizes for the IME and the keyboard simply covers the bottom of the screen. Padding by the
 * keyboard height (both platforms) shrinks the scroll area to end at the keyboard, and once the keyboard
 * is up the focused field is scrolled into that area with room for the button below it. Taps on buttons
 * still land while the keyboard is up. Found on the S25 (2026-11-02): the email/password fields and
 * Sign in sat under the keyboard.
 */
export function KeyboardScroll({
  children,
  contentContainerClassName,
  onLayout,
  onScroll,
  ...scroll
}: ScrollViewProps & { children: ReactNode; contentContainerClassName?: string }) {
  const ref = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const viewport = useRef(0);
  const offset = useRef(0);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      const input = TextInput.State.currentlyFocusedInput() as unknown as View | null;
      const inner = content.current;
      if (!input || !inner) return;
      // Measure after the padding has applied (two frames: KAV re-lays out, then the ScrollView), in
      // content coordinates.
      setTimeout(
        () =>
          input.measureLayout(
            inner,
            (_x, y, _w, h) => {
              const bottom = y + h + ROOM_BELOW_FOCUSED;
              if (bottom > offset.current + viewport.current) {
                ref.current?.scrollTo({ y: bottom - viewport.current, animated: true });
              }
            },
            () => {},
          ),
        150,
      );
    });
    return () => sub.remove();
  }, []);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        ref={ref}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        scrollEventThrottle={32}
        onLayout={(e) => {
          viewport.current = e.nativeEvent.layout.height;
          onLayout?.(e);
        }}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
          onScroll?.(e);
        }}
        contentContainerStyle={{ flexGrow: 1 }}
        {...scroll}
      >
        {/* The measured wrapper carries the caller's content-container classes (gap, justify, padding). */}
        <View ref={content} collapsable={false} className={contentContainerClassName}>
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
