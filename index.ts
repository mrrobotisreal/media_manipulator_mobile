// Entry (MA24): RN Firebase needs `setBackgroundMessageHandler` at module scope before the app registers,
// so the entry registers it first and then hands over to Expo Router's own entry.
import './src/push/background';
import 'expo-router/entry';
