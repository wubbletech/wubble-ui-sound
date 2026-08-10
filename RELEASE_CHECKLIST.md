# Release Checklist

Do not run the publish path in `.github/workflows/release.yml` until every item is complete.

- [ ] Choose the intended semver version, run `npm run release:version -- <version>`, review the package manifests, add the matching `CHANGELOG.md` entry, and commit that release candidate.
- [ ] Choose and add the public package license after legal review.
- [ ] Create the public GitHub repository and set its final URL in package metadata.
- [ ] Claim the `@wubble` npm organization and configure publish access.
- [ ] Configure npm trusted publishing for this repository and protect the GitHub `npm-production` Environment with named release approvers.
- [ ] Enable GitHub private vulnerability reporting and configure a monitored response route.
- [ ] Configure branch protection, required CI checks, merge policy, and named maintainers.
- [ ] Replace temporary support guidance with a monitored support address and response target.
- [ ] Run the manual browser matrix from the execution runbook.
- [ ] Run `npm ci`, `npm run check`, `npm test`, the Next production build, npm audit, and `npm run release:smoke` from a clean clone.
- [ ] Review the generated package file lists, changelog, semantic versions, and migration notes.
- [ ] Dispatch the release workflow with `publish: false`; it must verify the committed version and install the exact packed artifacts into clean vanilla and Next.js apps.
- [ ] After publishing, test each package installation from the public registry in a clean vanilla app and a clean Next.js app.
- [ ] Verify documentation URLs, package names, release notes, status page, terms, privacy policy, and commercial asset rights.
