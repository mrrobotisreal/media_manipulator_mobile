import { useState } from 'react';
import { View } from 'react-native';
import { Button, Sheet, Text, TextField } from '@/ui/components';
import { authErrorKey } from '../errors';
import type { AuthMethod } from '../methods';
import { availableReauthMethods, reauthenticate, ReauthCancelled } from '../reauth';
import { authT } from '../strings';

/** Mounted by MA22 for account deletion. Calls `onDone(freshIdToken)` after a successful re-auth. */
export function ReauthSheet({
  visible,
  onClose,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: (idToken: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const methods = availableReauthMethods();

  const run = async (method: AuthMethod) => {
    setBusy(true);
    setError(null);
    try {
      const token = await reauthenticate(
        method === 'email' ? { kind: 'password', password } : { kind: method },
      );
      setPassword('');
      onDone(token);
    } catch (e) {
      if (!(e instanceof ReauthCancelled)) setError(authT(`errors.${authErrorKey(e)}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="gap-3" testID="reauth-sheet">
        <Text className="text-lg font-semibold">{authT('reauth.title')}</Text>
        <Text className="text-muted-fg">{authT('reauth.body')}</Text>
        {methods.includes('email') ? (
          <>
            <TextField
              label={authT('reauth.password')}
              secureTextEntry
              autoComplete="current-password"
              value={password}
              onChangeText={setPassword}
              error={error}
            />
            <Button
              label={authT('reauth.withPassword')}
              loading={busy}
              disabled={password.length === 0}
              onPress={() => void run('email')}
            />
          </>
        ) : null}
        {methods.includes('google') ? (
          <Button
            label={authT('reauth.withGoogle')}
            variant="secondary"
            disabled={busy}
            onPress={() => void run('google')}
          />
        ) : null}
        {methods.includes('apple') ? (
          <Button
            label={authT('reauth.withApple')}
            variant="secondary"
            disabled={busy}
            onPress={() => void run('apple')}
          />
        ) : null}
        {error && !methods.includes('email') ? <Text className="text-danger">{error}</Text> : null}
        <Button label={authT('reauth.cancel')} variant="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}
