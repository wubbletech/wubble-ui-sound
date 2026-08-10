export const COMMUNITY_PERSONALITIES = Object.freeze([
  "minimal", "soft", "glass", "arcade", "mechanical", "organic",
  "dreamy", "scifi", "rubber", "cinematic", "studio", "zen"
]);

export const catalogDirectoryUrl = new URL("./catalog/", import.meta.url);

/** @param {string} personality */
export function communityPackUrl(personality) {
  if (!COMMUNITY_PERSONALITIES.includes(personality)) {
    throw new Error(`Unknown community personality: ${personality}`);
  }
  return new URL(`./${personality}.manifest.json`, import.meta.url);
}

/** @param {string} personality */
export function communityManifestUrl(personality) {
  return communityPackUrl(personality);
}
