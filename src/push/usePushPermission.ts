import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getPermissionState, type PermissionState } from './permission';

/** OS notification permission, re-read when the app returns to the foreground (e.g. from system settings). */
export function usePushPermission(): { state: PermissionState | null; refresh: () => void } {
  const [state, setState] = useState<PermissionState | null>(null);
  const refresh = useCallback(() => {
    void getPermissionState().then(setState);
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);
  return { state, refresh };
}
