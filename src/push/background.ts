import { pushMessaging } from './messaging';

// Registered at import time, before the app registers (index.ts imports this first). The notification
// payload is displayed by the OS, so the handler does nothing.
pushMessaging.setBackgroundMessageHandler();
