/** Absolute file URLs for use with the Wubble CLI or custom build tooling. */
export const packDirectoryUrl = new URL("./pack/", import.meta.url);
export const manifestUrl = new URL("./pack/manifest.json", import.meta.url);
