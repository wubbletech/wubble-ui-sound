# Wubble Community SFX Catalog

This is an optional catalog of CC0 audio, kept separate from Wubble Core so normal
installations remain compact. It contains 12 personalities, 78 upstream cues, and
portable MP3/Ogg files. The original audio and license notice are preserved in this
package; see `UPSTREAM-NOTICE.md` and `LICENSE-AUDIO`.

It is not a Wubble-original pack and does not replace Wubble Core. It provides a
large, no-cost catalog while teams decide whether to use a curated Wubble pack or
commission a custom one.

## Install and export

```bash
npm install @wubble/community-sfx @wubble/ui-sounds
npx wubble-ui-sounds export \
  --source node_modules/@wubble/community-sfx/minimal.manifest.json \
  --target /absolute/path/to/customer-app
```

Replace `minimal` with `soft`, `glass`, `arcade`, `mechanical`, `organic`, `dreamy`,
`scifi`, `rubber`, `cinematic`, `studio`, or `zen`. Each export selects only 16
Wubble semantic cues. Community packs preserve both MP3 and Ogg and declare a 240
KB budget; Wubble Core remains the compact 120 KB option. The application serves
those exported files locally and makes no runtime request to Wubble.

The complete upstream catalog remains under `catalog/` for use in platforms or
workflows that need the additional cues. Keep `LICENSE-AUDIO` and
`UPSTREAM-NOTICE.md` with any redistribution of the catalog.
