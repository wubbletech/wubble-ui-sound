# Contributing

Thanks for helping improve Wubble UI Sounds.

## Before opening a pull request

1. Search existing issues and discussions.
2. Keep the change focused on one user-visible behavior or maintenance concern.
3. Add or update a test for behavioral changes.
4. Run the full verification suite:

```bash
npm run generate:fixtures
npm run check
npm test
npm run build --workspace @wubble/nextjs-example
```

## Package boundaries

- `@wubble/manifest` owns the portable manifest contract.
- `@wubble/sounds` owns framework-neutral playback behavior.
- `@wubble/react` owns React-only integration.
- `@wubble/ui-sounds` owns local developer tooling and file export.

Do not introduce browser globals into the manifest package. Browser audio must remain optional, client-side, and unable to interrupt a product action.

## Release preparation

Package versions are prepared in the source commit, never changed for the first time inside the publish runner:

```bash
npm run release:version -- 0.1.0
# Review the seven package manifests and the release example dependency, add CHANGELOG.md notes, then commit.
npm run release:version -- 0.1.0 --check
npm run release:smoke
```

`release:smoke` packs every public workspace and installs those exact artifacts into clean vanilla and Next.js projects. The publish job only runs after this verification job and the protected `npm-production` environment approve it.

## Pull requests

Explain the user problem, the behavior before and after, validation performed, and any compatibility effect. Do not include generated builds, credentials, production data, or unrelated formatting changes.
