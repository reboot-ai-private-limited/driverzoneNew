/**
 * The app entry point, and the ORDER of these imports is load-bearing.
 *
 * `backgroundMessage` registers the FCM handler at module scope. It has to run before anything
 * else so the handler exists when FCM wakes a killed or backgrounded process in a headless
 * state — there is no React and no navigation at that moment, only whatever module scope already
 * ran. Registering it inside a component would mean it only exists once the app is running,
 * which is the one case it is not needed for.
 *
 * `expo-router/entry` then boots the app normally. `package.json` points `main` here rather than
 * straight at expo-router precisely so this can go first.
 */
import './src/notifications/backgroundMessage';

import 'expo-router/entry';
