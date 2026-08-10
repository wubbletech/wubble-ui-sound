# Wubble Core Pack

`@wubble/core-pack` contains the compact 16-cue Wubble Core feedback pack. It is an install-time asset package: the Wubble CLI copies its hashed local files into the developer's application. Customer applications do not call a Wubble service at playback time.

```bash
npm install @wubble/ui-sounds
npx wubble-ui-sounds setup /absolute/path/to/your-app
```

For React Native, pass `--platform react-native`; the CLI selects the local AAC/M4A source and writes a static Metro asset map.
