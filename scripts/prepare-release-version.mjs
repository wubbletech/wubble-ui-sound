import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const packageDirectories = [
  "packages/manifest",
  "packages/sounds",
  "packages/react",
  "packages/react-native",
  "packages/cli",
  "packages/core-pack",
  "packages/community-sfx"
];
const packageNames = new Set([
  "@wubble/manifest",
  "@wubble/sounds",
  "@wubble/react",
  "@wubble/react-native",
  "@wubble/ui-sounds",
  "@wubble/core-pack",
  "@wubble/community-sfx"
]);
const [version, mode] = process.argv.slice(2);

if (!isReleaseVersion(version) || (mode && mode !== "--check")) {
  console.error("Usage: node scripts/prepare-release-version.mjs <semver-version> [--check]");
  process.exitCode = 1;
} else {
  const packages = await Promise.all(packageDirectories.map(async (directory) => {
    const file = path.join(process.cwd(), directory, "package.json");
    return { file, value: JSON.parse(await readFile(file, "utf8")) };
  }));

  const prepared = packages.map(({ file, value }) => ({
    file,
    value: {
      ...value,
      version,
      dependencies: rewriteInternalVersions(value.dependencies, version)
    }
  }));

  if (mode === "--check") {
    const mismatches = prepared.filter(({ file, value }, index) => JSON.stringify(value) !== JSON.stringify(packages[index].value)).map(({ file }) => file);
    if (mismatches.length > 0) {
      console.error(`Release version ${version} is not prepared in:\n${mismatches.map((file) => `- ${path.relative(process.cwd(), file)}`).join("\n")}`);
      process.exitCode = 1;
    } else {
      console.log(`Release version ${version} is prepared across ${prepared.length} public packages.`);
    }
  } else {
    await Promise.all(prepared.map(({ file, value }) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")));
    console.log(`Prepared ${prepared.length} public packages for ${version}. Review and commit the package manifests before dispatching a release.`);
  }
}

/** @param {Record<string, string> | undefined} dependencies @param {string} version */
function rewriteInternalVersions(dependencies, version) {
  if (!dependencies) return dependencies;
  return Object.fromEntries(Object.entries(dependencies).map(([name, range]) => [name, packageNames.has(name) ? version : range]));
}

/** @param {string | undefined} value */
function isReleaseVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}
