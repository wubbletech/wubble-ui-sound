# React Native Example

This is the mobile integration shape, not a packaged app. Copy approved mobile pack assets into `assets/`, generate the matching `wubble-manifest.json`, and add their static Metro `require()` calls to the asset map in `App.js`.

Install the runtime packages in an Expo application:

```bash
npm install @wubbleai/react-native @wubbleai/manifest
npx expo install expo-audio expo-haptics
```

`createExpoFeedbackBridge()` uses bundled assets only. It creates and releases a native player per cue, uses the measured manifest duration only as a bounded completion fallback, and maps semantic haptic intent to native selection or notification feedback. Keep visible state changes and accessibility feedback independent of audio.
