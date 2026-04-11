# Releasing @rafters/mail

This repo publishes nine npm packages via OIDC-based trusted publishing from GitHub Actions. No long-lived npm tokens exist or are expected anywhere -- not in `.npmrc`, not in GitHub Actions secrets, not in developer machines.

## One-time setup (per package, before first publish)

Every package must have a trusted publisher configured on npmjs.org before its first publish. This is a one-time step per package and does not need to be repeated for subsequent releases.

For each of the nine packages:

- `@rafters/mail`
- `@rafters/mail-resend`
- `@rafters/mail-cloudflare`
- `@rafters/mail-react-email`
- `@rafters/mail-workers-ai`
- `@rafters/better-auth-resend`
- `@rafters/mail-imap`
- `@rafters/mail-imap-cloudflare`
- `@rafters/mail-imap-server`

Do the following on npmjs.org:

1. If the `@rafters` scope does not exist yet, create the org at <https://www.npmjs.com/org/create> and name it `rafters` (matching the `@rafters/...` package prefix).
2. For each package above:
   - Go to <https://www.npmjs.com/package/PACKAGE-NAME/access> (the page will 404 until the package exists -- see "first publish" below for the pending-publisher flow).
   - Or, for brand-new packages, use the pending trusted publisher flow at <https://docs.npmjs.com/trusted-publishers> which allows configuring the publisher before the package exists.
   - Configure a trusted publisher with:
     - **Publisher:** GitHub Actions
     - **Organization or user:** `rafters-studio`
     - **Repository:** `mail`
     - **Workflow filename:** `release.yml`
     - **Environment name:** (leave blank)

Each package needs its own trusted publisher entry. There is no way to configure the whole scope at once.

## Release procedure

Once the per-package trusted publisher setup is done, releasing is:

```bash
# 1. Make sure main is clean and pulled
git checkout main
git pull origin main

# 2. Consume pending changesets and bump versions
pnpm changeset version

# 3. Commit the version bump
git add .
git commit -m "chore(release): $(node -p "require('./packages/core/package.json').version")"

# 4. Tag the release (use the version that changeset version produced)
git tag "v$(node -p "require('./packages/core/package.json').version")"

# 5. Push main and the tag
git push origin main
git push origin --tags
```

The tag push triggers `.github/workflows/release.yml`, which:

1. Installs and builds all packages
2. Runs `pnpm changeset publish` (which iterates and publishes every package whose version is not already on npm)
3. `NPM_CONFIG_PROVENANCE=true` causes each `npm publish` to use the OIDC trusted-publisher flow
4. Creates a GitHub Release with auto-generated notes

## Troubleshooting

If the release workflow fails with an npm auth error, the problem is almost always one of the following. In order of frequency:

**"401 Unauthorized" or "you must be logged in to publish packages"**

The trusted publisher for that specific package is not configured, or is configured for the wrong repo/workflow path. Check <https://www.npmjs.com/package/PACKAGE-NAME/access> and confirm the trusted publisher shows `rafters-studio/mail` with workflow `release.yml`.

**"403 Forbidden: you do not have permission to publish"**

The trusted publisher is configured but you tried to publish without `NPM_CONFIG_PROVENANCE=true` set. The workflow sets this at the step level. If it is missing, add it back.

**"EBADENGINE" or lockfile resolution errors**

`pnpm install --frozen-lockfile` failed because package.json and pnpm-lock.yaml disagree. Regenerate the lockfile locally and commit it.

**"OIDC provider token expired" or similar mid-publish**

The workflow is hitting rate limits or the OIDC token is expiring before all nine packages finish publishing. Split the publish step across multiple jobs, or re-run the workflow manually for the missing packages.

**Workflow fails before reaching the publish step**

CI gates (build, typecheck, lint, test) are failing. Fix them and re-tag. The tag can be deleted and re-pushed: `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z && git tag vX.Y.Z && git push origin vX.Y.Z`.

## OIDC design notes

Do not:

- Add `registry-url` to the `setup-node` action. It writes a `.npmrc` with `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` and npm refuses OIDC when a token is expected.
- Set `NODE_AUTH_TOKEN` in the publish step env, even to an empty string. Any value short-circuits the OIDC exchange.
- Use `setup-node`'s `always-auth` option.
- Store an npm token in GitHub Actions secrets. There is no reason to, and it is a long-term credential leak risk.

Do:

- Keep the `id-token: write` workflow permission.
- Use `NPM_CONFIG_PROVENANCE=true` (or `--provenance` on the `npm publish` command).
- Match the `workflow_filename` in the trusted publisher config to the actual file at `.github/workflows/release.yml`. Renaming the file breaks trusted publishing until the config is updated.

## Why not changesets/action?

The `changesets/action` GitHub Action can open automatic "Version Packages" PRs that consume pending changesets. It is powerful but has repeatedly conflicted with OIDC configurations in sibling repos. For now this repo uses a manual tag-triggered release -- the developer runs `pnpm changeset version` locally, commits, tags, and pushes. The tag push is the only thing that triggers a publish. If we later want automatic version PRs, `changesets/action` can be added alongside the existing workflow.
