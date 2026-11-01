import Constants from 'expo-constants';

/**
 * True when the build was configured with a Firebase config file
 * (app.config.ts omits the file keys when it is missing). MA04 uses this to show
 * "Sign-in is not available in this build" instead of crashing.
 */
export function isFirebaseConfigured(): boolean {
  const cfg = Constants.expoConfig;
  return Boolean(cfg?.android?.googleServicesFile || cfg?.ios?.googleServicesFile);
}
