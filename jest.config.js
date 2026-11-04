module.exports = {
  preset: 'jest-expo',
  // redux-persist / MMKV mocks leave timers open; tests are hermetic so exit is safe.
  forceExit: true,
  // RNGH's own mocks: GestureHandlerRootView (inside every Sheet's Modal) renders without the native module.
  setupFiles: ['react-native-gesture-handler/jestSetup'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|nativewind|react-native-css-interop|lucide-react-native|react-native-reanimated|react-native-worklets|react-native-svg|react-native-mmkv|react-native-nitro-modules|immer|@reduxjs/toolkit|redux|redux-thunk|reselect|redux-persist|react-redux|@react-native-firebase/.*))',
  ],
};
