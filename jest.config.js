module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|nativewind|react-native-css-interop|lucide-react-native|react-native-reanimated|react-native-worklets|react-native-svg|react-native-mmkv|react-native-nitro-modules|immer|@reduxjs/toolkit|redux|redux-thunk|reselect|redux-persist|react-redux|@react-native-firebase/.*))',
  ],
};
