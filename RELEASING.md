# Releasing @rafters/mail

Subsequent releases (`0.1.1`, `0.2.0`, ...) publish via OIDC-based trusted publishing from GitHub Actions -- no long-lived npm tokens anywhere. The **first release of each package** is a manual `npm publish` from a maintainer's machine, because npm cannot configure a trusted publisher on a package that does not yet exist on the registry.

## Bootstrap: the first publish of each package (manual, maintainer-only)

This section runs once per package, ever. The maintainer (Sean) runs it from their local machine with their personal npm login. After this, every subsequent release for that package flows through the GitHub Actions workflow.

**Prerequisites:**

1. Logged in to npm as a maintainer with publish rights to the `@rafters` scope:
   ```bash
   npm login
   npm whoami  # confirm identity
   ```
2. If the `@rafters` org does not exist yet, create it at <https://www.npmjs.com/org/create> and name it `rafters`.
3. Main is clean and the `chore/imap-build-pipeline` changes are merged, so all 9 packages have a `dist/` output.
4. Local build is fresh:
   ```bash
   pnpm install
   pnpm -r build
   ```

**The nine packages in dependency order:**

```
@rafters/mail                   (core, no workspace deps)
@rafters/mail-imap              (depends on @rafters/mail)
@rafters/mail-resend            (depends on @rafters/mail)
@rafters/mail-cloudflare        (depends on @rafters/mail)
@rafters/mail-react-email       (depends on @rafters/mail)
@rafters/mail-workers-ai        (depends on @rafters/mail)
@rafters/better-auth-resend     (depends on @rafters/mail-resend + @rafters/mail-react-email)
@rafters/mail-imap-cloudflare   (depends on @rafters/mail-imap)
@rafters/mail-imap-server       (depends on @rafters/mail-imap)
```

Dependency order matters only if you want installs to work between steps. npm publish itself does not enforce it.

**Run the first publish for each package:**

```bash
cd packages/core             && pnpm publish --access public --no-git-checks
cd ../imap                   && pnpm publish --access public --no-git-checks
cd ../resend                 && pnpm publish --access public --no-git-checks
cd ../cloudflare             && pnpm publish --access public --no-git-checks
cd ../react-email            && pnpm publish --access public --no-git-checks
cd ../workers-ai             && pnpm publish --access public --no-git-checks
cd ../better-auth-resend     && pnpm publish --access public --no-git-checks
cd ../imap-cloudflare        && pnpm publish --access public --no-git-checks
cd ../imap-server            && pnpm publish --access public --no-git-checks
cd ../..
```

`--no-git-checks` skips pnpm's check that the branch is clean and pushed; we want the publish to reflect the local dist.

Each publish creates the package on the npm registry at the current package.json version (likely `0.0.1` initially).

## One-time setup: configure a trusted publisher per package

Once each package exists on npm, configure the trusted publisher on each one so subsequent releases can go through GitHub Actions with no token.

For each of the nine packages:

1. Go to `https://www.npmjs.com/package/PACKAGE-NAME/access`
2. Find the "Trusted publishers" section
3. Add a new trusted publisher with:
   - **Publisher:** GitHub Actions
   - **Organization or user:** `rafters-studio`
   - **Repository:** `mail`
   - **Workflow filename:** `release.yml`
   - **Environment name:** (leave blank)

Each package needs its own trusted publisher entry. There is no way to configure the whole scope at once. Nine packages = nine trusted publisher configurations.

After this one-time setup, every subsequent release of these packages flows through the release workflow below.

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
