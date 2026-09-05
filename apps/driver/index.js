/**
 * The app entry point, and the ORDER of these imports is load-bearing.
 *
 * `backgroundMessage` registers the FCM handler at module scope. It has to run before anything
 * else so the handler exists when FCM wakes a killed process in a headless state — there is no
 * React and no navigation at that moment, only whatever module scope already ran.
 *
 * `dutyForegroundService` registers the foreground-service task for the same reason: Android can
 * recreate the service on its own (docs/LLD/driver-app.md S-8) and hand it back to a process with
 * no React mounted yet, so a task registered inside a component would not exist at the moment it
 * is needed.
 *
 * `expo-router/entry` then boots the app normally. `package.json` points `main` here rather than
 * straight at expo-router precisely so these can go first.
 */
import './src/notifications/backgroundMessage';
import './src/duty/dutyForegroundService';

import 'expo-router/entry';
