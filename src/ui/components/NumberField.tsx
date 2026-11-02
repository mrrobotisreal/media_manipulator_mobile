/* eslint-disable react-hooks/set-state-in-effect -- syncs the typed text to an external value change. */
import { useEffect, useState } from 'react';
import { TextField, type TextFieldProps } from './TextField';

/** Decimal input that keeps its own text while typing and reports a number (or null when empty/invalid). */
export function NumberField({
  value,
  onValue,
  integer = false,
  ...rest
}: Omit<TextFieldProps, 'value' | 'onChangeText' | 'keyboardType'> & {
  value: number | null;
  onValue: (n: number | null) => void;
  integer?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    // External changes (a preset, a reset) win; local typing that parses to the same number does not.
    setText((cur) => {
      const parsed = cur.trim() === '' ? null : Number(cur.replace(',', '.'));
      return parsed === value || (parsed !== null && Number.isNaN(parsed) && value === null)
        ? cur
        : value === null
          ? ''
          : String(value);
    });
  }, [value]);
  return (
    <TextField
      {...rest}
      value={text}
      keyboardType={integer ? 'number-pad' : 'decimal-pad'}
      onChangeText={(s) => {
        setText(s);
        const trimmed = s.trim().replace(',', '.');
        if (trimmed === '') return onValue(null);
        const n = Number(trimmed);
        onValue(Number.isFinite(n) ? (integer ? Math.round(n) : n) : null);
      }}
    />
  );
}
