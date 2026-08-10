import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const packageDirectories = ["packages/manifest", "packages/sounds", "packages/react", "packages/react-native", "packages/cli", "packages/community-sfx"];
const requiredFields = ["name", "version", "description", "license", "repository", "homepage", "bugs"];
const [version] = process.argv.slice(2);

if (!isReleaseVersion(version)) {
  console.error("Usage: node scripts/verify-release-metadata.mjs <semver-version>");
  process.exitCode = 1;
} else {
  const errors = [];
  for (const directory of packageDirectories) {
    const file = path.join(process.cwd(), directory, "package.json");
    const value = JSON.parse(await readFile(file, "utf8"));
    for (const field of requiredFields) {
      if (!value[field]) errors.push(`${directory}/package.json is missing ${field}.`);
    }
    if (value.version !== version) errors.push(`${directory}/package.json has ${value.version}, expected ${version}.`);
  }

  const changelog = await readFile(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
  if (!changelog.includes(`## ${version}`)) errors.push(`CHANGELOG.md is missing a ## ${version} release entry.`);

  if (errors.length > 0) {
    console.error(`Release metadata is incomplete:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`Release metadata is complete for ${version}.`);
  }
}

/** @param {string | undefined} value */
function isReleaseVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}
