# Wubble Community SFX Catalog

This is the CC0 audio catalog used by `@wubble/ui-sounds`. It is installed
automatically with the main package, so developers do not need to choose or
install a second Wubble package. It contains 12 personalities, 78 upstream cues,
and portable MP3/Ogg files. The original audio and license notice are preserved
in this package; see `UPSTREAM-NOTICE.md` and `LICENSE-AUDIO`.

## Install and export

```bash
npm install @wubble/ui-sounds
npx wubble-ui-sounds export \
  --source node_modules/@wubble/community-sfx/minimal.manifest.json \
  --target /absolute/path/to/customer-app
```

Replace `minimal` with `soft`, `glass`, `arcade`, `mechanical`, `organic`, `dreamy`,
`scifi`, `rubber`, `cinematic`, `studio`, or `zen`. Each export selects only 16
Wubble semantic cues. Community packs preserve both MP3 and Ogg and declare a 240
KB budget; the default Wubble Core export remains the compact 120 KB option. The application serves
those exported files locally and makes no runtime request to Wubble.

The complete upstream catalog remains under `catalog/` for use in platforms or
workflows that need the additional cues. Keep `LICENSE-AUDIO` and
`UPSTREAM-NOTICE.md` with any redistribution of the catalog.
