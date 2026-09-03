/**
 * The app entry point, and the ORDER of these two imports is load-bearing.
 *
 * `backgroundMessage` registers the FCM handler at module scope. It has to run before anything
 * else so the handler exists when FCM wakes a killed process in a headless state — there is no
 * React and no navigation at that moment, only whatever module scope already ran.
 *
 * `expo-router/entry` then boots the app normally. `package.json` points `main` here rather than
 * straight at expo-router precisely so this file can go first.
 */
import './src/notifications/backgroundMessage';

import 'expo-router/entry';
