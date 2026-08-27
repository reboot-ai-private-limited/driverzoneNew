/// <reference types="expo/types" />

// Brings in Expo's ambient types, including the `process.env.EXPO_PUBLIC_*` declarations that
// `src/lib/config.ts` reads.
//
// This lives in src/ rather than at the project root ON PURPOSE. Expo's CLI owns the root
// `expo-env.d.ts` and rewrites `tsconfig.json#include` on `expo start` and `expo prebuild` — it
// deleted the root copy once already, which fails the typecheck with a bare "Cannot find name
// 'process'". Under src/ it is picked up by the `**/*.ts` include and left alone.
