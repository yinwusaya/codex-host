# Personal Fork Releases

## Code And Runtime

- Repository: `https://github.com/yinwusaya/codex-host`.
- Personal development and release candidates: `dev`. Merge upstream changes into this branch without discarding personal changes.
- G7 is the designated development machine. Source synchronization is not an application update: fetching or merging code does not build, install, or restart a runtime.
- Daily-use machines install verified releases from this fork. Windows/macOS installers and Linux npm tarballs may differ in format but must come from the same release commit.
- A source checkout remains a development installation; never manufacture `codexhost-distribution.json` to enable self-update.

## Release

1. Check `git status --short --branch` and ensure the intended changes are on `dev`. Do not switch branches over uncommitted work or overwrite local commits.
2. Choose a new, monotonically increasing SemVer and run `npm run release:prepare -- <version>`. This synchronizes the npm and Cargo versions. Do not reuse upstream tags or an already published version.
3. Review the four version files, run the relevant local checks, and push the approved changes to `origin/dev`. The exact release commit must pass all four baseline jobs of the `dev` push CI. PR CI or a successful `main` CI is not a substitute.
4. Prepare nonempty annotated-tag Release Notes and obtain user approval before creating or pushing `v<version>` at that exact commit. Tag push triggers `Release packages`. Never move a published tag.
5. The workflow checks out trusted automation from `dev`, verifies tag membership in `dev`, builds all platforms from the pinned commit, and checks the same tag and CI attempt again before publication. Forks skip npm registry publication entirely.
6. Verify the resulting GitHub Release, assets and `release-evidence.json`. Queued jobs or a pushed tag are not a completed release.

For normal updates use a stable SemVer and a non-prerelease GitHub Release. Prerelease versions and `github_prerelease=true` releases are manual-download previews and are not offered by the latest-release updater. Build metadata (`+...`) alone does not advance SemVer precedence and must not be used as the only update counter. The release commit SHA is recorded separately.

Recovery uses an existing, verified annotated tag and manual `Release packages` with branch `dev`; do not rerun an old workflow that predates fork support. CI remains required unless the user explicitly authorizes `skip_ci=true`. GitHub requires the workflow file on the repository's default branch for manual dispatch; if absent, publish the workflow there through a separately approved change before using manual dispatch. This does not require changing the fork's default branch or moving development off `dev`.

## Artifacts And Installation

The fork Release contains four EXE/DMG installers, six platform npm tarballs, one CLI meta tarball, and `release-evidence.json`. Each platform payload includes its `version`, `distribution`, `target`, `repository` and full source `commit`. Build jobs stamp `CODEXHOST_RELEASE_REPOSITORY` and `CODEXHOST_RELEASE_COMMIT` from the workflow repository and verified commit, not from credentials or the build job's ambient checkout SHA.

Use Node.js managed by the machine's version manager for npm installations. First-install example (replace `<version>` with an actually published version):

```sh
npm install --global --prefix "$HOME/.local/share/codexhost" \
  "https://github.com/yinwusaya/codex-host/releases/download/v<version>/codexhost-cli-<version>.tgz"
```

The meta package resolves platform dependencies to URLs in the same fork Release, not `@codexhost/*` versions from the npm registry. Keep the prefix fixed across updates and keep its `bin/codexhost` as the sole daily-use entry. Do not install the repository root with npm. Existing G7 uses this prefix; retain its existing wrapper and Node selection rather than installing another runtime.

For Windows/macOS, use this fork's matching installer. Do not mix npm and installer entrypoints for the same daily-use instance. Installer format alone does not imply an upstream build: the repository and commit in the payload identify its source.

## Updates

Run `codexhost update` from the installed fork entry or use its update settings. The Host and standalone Console read the installed repository identity; HTTP and GitHub CLI discovery, Release Notes and selected assets all stay within that repository and tag. Missing assets, invalid digests, malformed metadata or network failure stop the update; none silently select upstream releases.

Fork npm updates download both tarballs before installation, check their SHA-256 again in the native Updater, and install them explicitly with the original global prefix. The current machine's Node and npm paths remain in use. EXE/DMG updates retain their existing native installation paths. Existing upstream installations without fork metadata retain upstream behavior and need an explicit first migration.

Updating may interrupt running tasks. Preserve the existing data directory and authentication locally; do not print, copy between machines or synchronize credentials. Check the actual Host and Web versions, running entry and release identity after reconnecting. A handed-off update request is not installation success; interrupted tasks do not resume automatically.

## Existing Machines

The code change does not migrate or restart any machine. Before a first migration, identify its active entry, installation format, Node/npm paths, prefix, data directory and startup service without reading credentials. Finish running tasks, preserve the existing data directory, install the chosen fork release, update the sole startup entry, then verify it. Do not uninstall or delete the old installation until the replacement is verified and cleanup is authorized.

G7's previously recorded daily synchronization targets `origin/main`; it has not been changed to `dev` by this implementation. Reconcile that timer with the actual G7 worktree in a separate authorized operation, preserving local commits. Likewise, the Ubuntu work machine's source checkout remains unchanged until a real fork release is available and migration is explicitly performed.

The existing SSH provisioning path is separate from local Host self-update. Fork installations reject registry-based SSH installation and upgrades, and fork remote services report that the old remote updater is unsupported. Install or upgrade these services manually from the fork Release; inspection, repair using the installed CLI, and uninstall remain unchanged. Source development builds carry no release identity and must not be used for registry-based fork migration. This implementation does not change remote service installations or Tailscale routing.
