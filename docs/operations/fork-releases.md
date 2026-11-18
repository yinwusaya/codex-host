# Personal Fork Releases

## Code And Runtime

- Repository: `https://github.com/yinwusaya/codex-host`.
- Branch flow: upstream `BytePioneer-AI/codex-host` `main` -> `upstream-sync` -> `dev` -> personal production `main` -> release tag.
- `upstream-sync` is a fast-forward-only upstream mirror; never add personal commits there. `dev` owns personal development and upstream integration. `main` accepts only validated, explicitly approved production candidates from `dev`; never synchronize upstream directly into production.
- Before release preparation, refresh `upstream-sync` from upstream `main`, then merge the intended upstream changes into `dev` without discarding personal changes. Verify the integrated candidate before choosing a release version; fetching alone is not integration.
- G7 is the designated development machine. Source synchronization is not an application update: fetching or merging code does not build, install, or restart a runtime.
- Daily-use machines install verified releases from this fork. Windows/macOS installers and Linux npm tarballs may differ in format but must come from the same release commit.
- A source checkout remains a development installation; never manufacture `codexhost-distribution.json` to enable self-update.

## Release

1. Check `git status --short --branch` and ensure the intended changes are on `dev`. Do not switch branches over uncommitted work or overwrite local commits. For the initial branch conversion, preserve the old upstream-only `main` tip in `upstream-sync` before repointing production `main`; obtain explicit approval for that exact ref change.
2. Choose a new, monotonically increasing SemVer and run `npm run release:prepare -- <version>` on `dev`. This synchronizes the npm and Cargo versions. Do not reuse upstream tags or an already published version.
3. Review the four version files, run the relevant local checks, and push the approved changes to `origin/dev`. After validation, report the candidate and obtain separate user confirmation before promoting it to production `main`. The exact release commit must then pass all four baseline jobs of the `main` push CI. PR CI or a successful `dev` CI is not a substitute.
4. Prepare nonempty annotated-tag Release Notes and obtain user approval before creating or pushing `v<version>` at that exact commit. Tag push triggers `Release packages`. Never move a published tag.
5. The workflow checks out trusted automation from `main`, verifies tag membership in `main`, builds all platforms from the pinned commit, and checks the same tag and CI attempt again before publication. Forks skip npm registry publication entirely. `dev` and `upstream-sync` are not release branches.
6. Verify the resulting GitHub Release, assets and `release-evidence.json`. Queued jobs or a pushed tag are not a completed release.

For normal updates use a stable SemVer and a non-prerelease GitHub Release. Prerelease versions and `github_prerelease=true` releases are manual-download previews and are not offered by the latest-release updater. Build metadata (`+...`) alone does not advance SemVer precedence and must not be used as the only update counter. The release commit SHA is recorded separately.

Recovery uses an existing, verified annotated tag and manual `Release packages` with branch `main`; do not rerun an old workflow that predates fork support. CI remains required unless the user explicitly authorizes `skip_ci=true`. GitHub requires the workflow file on the repository's default branch for manual dispatch; if absent, publish the workflow there through a separately approved change before using manual dispatch. Keep `main` as the fork's default production branch; development stays on `dev`.

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

G7's `$HOME/projects/codex-host` is the source-sync checkout on `upstream-sync`; `$HOME/projects/codex-host-dev` remains the sole development checkout on `dev`. The user-level `codexhost-daily-sync.timer` runs daily at 09:00 Asia/Shanghai. Its script fetches upstream `main`, fast-forwards only `upstream-sync`, and pushes that exact mirror tip to `origin/upstream-sync`. Dirty worktrees, in-progress Git operations, diverged history or failed pushes stop synchronization; it never merges into `dev`/production `main`, tags, builds, installs or restarts application services. Initial activation of this policy is a separately authorized branch/timer operation, not a side effect of editing release code. The Ubuntu work machine's source checkout remains unchanged until a real fork release is available and migration is explicitly performed.

The existing SSH provisioning path is separate from local Host self-update. Fork installations reject registry-based SSH installation and upgrades, and fork remote services report that the old remote updater is unsupported. Install or upgrade these services manually from the fork Release; inspection, repair using the installed CLI, and uninstall remain unchanged. Source development builds carry no release identity and must not be used for registry-based fork migration. This implementation does not change remote service installations or Tailscale routing.
