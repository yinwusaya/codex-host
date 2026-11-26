import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { createMacosShellInfoPlist } from "../../scripts/release/macos-shell-bundle.mjs";

const root = path.resolve(import.meta.dirname, "../..");

describe("platform packagers", () => {
  it("creates a standard ad-hoc signed macOS DMG", async () => {
    const source = await readFile(path.join(root, "scripts/release/macos/package.sh"), "utf8");
    expect(source).toContain('CONTENTS="$APP_PATH/Contents"');
    expect(source).toContain('RESOURCES="$CONTENTS/Resources"');
    expect(source).toContain('"$CONTENTS/Helpers/CodexHost.app"');
    expect(source).toContain("codesign --verify --deep --strict");
    expect(source).toContain('runtime/node" -e');
    expect(source).not.toContain("--options runtime");
    expect(source).toContain('"$ASSETS_DIR/codexhost-icon.png"');
    expect(source).not.toContain("sips -s format png");
    expect(source).toContain("iconutil -c icns");
    expect(source).toContain("CFBundleIconFile");
    expect(source).toContain("codexhost.icns");
    expect(source).toContain("NSMicrophoneUsageDescription");
    expect(createMacosShellInfoPlist("0.26.1")).toContain("NSMicrophoneUsageDescription");
    expect(source).toContain("create-dmg");
    expect(source).toContain("--window-size 800 400");
    expect(source).toContain("--window-pos 200 120");
    expect(source).toContain('--icon "codexhost.app" 200 190');
    expect(source).toContain("--app-drop-link 600 185");
    expect(source).toContain("installer-background.png");
    expect(source).not.toContain("layout_dmg_window");
    expect(source).not.toContain("osascript");
    expect(source).not.toContain("hdiutil convert");
    expect(source).not.toContain("ln -s /Applications");
    expect(source).toContain("hdiutil verify");
    expect(source).not.toContain("ditto -c -k");
    expect(source).not.toContain("cargo-packager");
  });

  it("publishes one tag-bound installer and npm release", async () => {
    const [workflow, releaseBuilder, releaseClient, releaseValidation] = await Promise.all([
      readFile(path.join(root, ".github/workflows/release-packages.yml"), "utf8"),
      readFile(path.join(root, "scripts/release/prepare-payload.mjs"), "utf8"),
      readFile(path.join(root, "packages/update-manager/src/github-release.ts"), "utf8"),
      readFile(path.join(root, "packages/repository-automation/src/release.mjs"), "utf8"),
    ]);
    expect(workflow).toContain('tags:\n      - "v*"');
    expect(workflow).not.toContain("types: [published]");
    expect(workflow).toContain("Resolve release metadata");
    expect(releaseValidation).toContain("does not match package.json version");
    expect(releaseValidation).toContain("does not match Cargo workspace version");
    expect(releaseValidation).toContain("must be an annotated tag with release notes");
    expect(releaseValidation).toContain("%(contents:body)");
    expect(workflow).toContain("npm_tag: result.npmTag");
    expect(workflow).toContain("ref: ${{ needs.prepare.outputs.commit_sha }}");
    expect(workflow).not.toContain("ref: ${{ needs.prepare.outputs.tag }}");
    expect(workflow).toContain(
      "Revalidate tag and selected CI policy immediately before npm publication",
    );
    expect(workflow).toContain(
      "Revalidate tag and selected CI policy immediately before GitHub publication",
    );

    expect(workflow).toContain("codexhost-*.dmg");
    expect(workflow).toContain("codexhost-*.exe");
    expect(workflow).toContain("codexhost-*.tar.gz");
    expect(workflow).not.toContain("codexhost-*.msi");
    expect(workflow).toContain("npm run release:npm --");
    expect(workflow).toContain("Build npm package from installer outputs");
    expect(workflow).toContain("Build and smoke-test Linux npm package");
    const linuxPackageStep = workflow.slice(
      workflow.indexOf("Build and smoke-test Linux npm package"),
    );
    const linuxPackageCommand = linuxPackageStep.slice(0, linuxPackageStep.indexOf("- name:", 1));
    expect(linuxPackageCommand).toContain("scripts/release/smoke-npm-package.mjs");
    expect(linuxPackageCommand).not.toContain("--skip-build");
    expect(workflow).toContain("--skip-build");
    expect(workflow).toContain("--pack");
    expect(workflow).toContain("codexhost-cli-*-${{ matrix.target }}.tgz");
    expect(workflow).toContain("Build installer package");
    expect(workflow).toContain("if: runner.os != 'Linux'");
    expect(workflow).toContain('target: "linux-x64"');
    expect(workflow).toContain('runner: "ubuntu-22.04"');
    expect(workflow).toContain(
      "--require-hashes --only-binary :all: -r scripts/release/linux-zigbuild-requirements.txt",
    );
    expect(workflow).toContain('rustTarget: "x86_64-unknown-linux-gnu"');
    expect(workflow).toContain('target: "linux-arm64"');
    expect(workflow).toContain('runner: "ubuntu-22.04-arm"');
    expect(workflow).toContain('rustTarget: "aarch64-unknown-linux-gnu"');
    expect(workflow).toContain("Build npm package");
    expect(workflow).toContain("matrix.target == 'linux-x64' && format('build/npm/{0}/meta/");
    expect(workflow).toContain("release:npm:publish");
    expect(workflow).toContain('--tag "$NPM_TAG"');
    expect(workflow).not.toContain("secrets.NPM_TOKEN");
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
    expect(workflow).toContain("id-token: write");

    expect(workflow).not.toContain("smoke-npm:");
    expect(workflow).not.toContain("npm view");
    expect(workflow).toContain("publish-release:");
    const publishRelease = workflow.slice(workflow.indexOf("  publish-release:"));
    expect(publishRelease).toContain("gh release create");
    expect(publishRelease).toContain('"codexhost-${VERSION}-windows-x64.exe"');
    expect(publishRelease).toContain('"codexhost-${VERSION}-windows-arm64.exe"');
    expect(publishRelease).toContain('"codexhost-${VERSION}-macos-x64.dmg"');
    expect(publishRelease).toContain('"codexhost-${VERSION}-macos-arm64.dmg"');
    expect(publishRelease).toContain('if [[ "$FORK_RELEASE" != "true" ]]; then');
    expect(publishRelease).toContain('"codexhost-${VERSION}-linux-x64.tar.gz"');
    expect(publishRelease).toContain('"codexhost-${VERSION}-linux-arm64.tar.gz"');
    expect(publishRelease).toContain('if [[ "$FORK_RELEASE" == "true" ]]; then');
    expect(publishRelease).toContain('expected+=("codexhost-cli-${VERSION}.tgz")');
    expect(workflow).not.toContain("softprops/action-gh-release");
    expect(workflow).not.toContain("codexhost-*.sha256");
    expect(workflow).not.toContain("checksums.txt");
    expect(workflow).not.toContain("update.json");
    expect(releaseBuilder).not.toContain("checksumPath");
    expect(releaseBuilder).not.toContain("sha256=${result.checksum}");
    expect(releaseClient).toContain("assets");
    expect(releaseClient).toContain("size");
    expect(releaseClient).toContain("digest");
    expect(releaseClient).toContain("sha256:");
  });

  it.skipIf(process.platform !== "linux").each([
    ["yinwusaya/codex-host-fork", true, false],
    ["BytePioneer-AI/codex-host", false, true],
    ["example/codex-host", true, true],
  ])("aligns the matrix and release assets for %s", async (repository, fork, includeMacos) => {
    const workflow = await readFile(
      path.join(root, ".github/workflows/release-packages.yml"),
      "utf8",
    );
    const matrixSource = workflow.slice(
      workflow.indexOf("            const packageMatrix = ["),
      workflow.indexOf("            await writeFile('release-notes.md'"),
    );
    let matrix;
    new Function("context", "core", matrixSource)(
      { payload: { repository: { full_name: repository } } },
      {
        setOutput: (_name, value) => {
          matrix = JSON.parse(value);
        },
      },
    );
    const targets = ["windows-x64", "windows-arm64", "linux-x64", "linux-arm64"];
    if (includeMacos) targets.push("macos-arm64", "macos-x64");
    expect(matrix.include.map(({ target }) => target).sort()).toEqual(targets.sort());
    expect(matrix.include.every(({ runner, rustTarget }) => runner && rustTarget)).toBe(true);
    expect(workflow).toContain("matrix: ${{ fromJSON(needs.prepare.outputs.package_matrix) }}");
    const assetSource = workflow.slice(
      workflow.indexOf("          expected=("),
      workflow.indexOf("          files=()"),
    );
    const result = spawnSync("bash", ["-c", assetSource + '\nprintf "%s\\n" "${expected[@]}"'], {
      encoding: "utf8",
      env: { VERSION: "1.2.3", FORK_RELEASE: String(fork), GITHUB_REPOSITORY: repository },
    });
    expect(result.status, result.stderr).toBe(0);
    const expected = targets
      .filter((target) => !target.startsWith("linux-"))
      .map((target) => `codexhost-1.2.3-${target}.${target.startsWith("macos-") ? "dmg" : "exe"}`);
    if (includeMacos) expected.push("codexhost-1.2.3-android.apk");
    if (!fork)
      expected.push("codexhost-1.2.3-linux-x64.tar.gz", "codexhost-1.2.3-linux-arm64.tar.gz");
    if (fork)
      expected.push(
        "codexhost-cli-1.2.3.tgz",
        ...targets.map((target) => `codexhost-cli-1.2.3-${target}.tgz`),
      );
    expect(result.stdout.trim().split("\n").sort()).toEqual(expected.sort());
  });

  it("prepares Windows process shutdown only after Install, using the bundled temporary helper", async () => {
    const installer = await readFile(
      path.join(root, "scripts/release/windows/Installer.iss"),
      "utf8",
    );
    const helper =
      'Source: "{#PayloadRoot}\\libexec\\codexhost-updater.exe"; DestName: "codexhost-install-helper.exe"; Flags: dontcopy';
    expect(installer).toContain(helper);
    expect(installer.indexOf(helper)).toBeLessThan(
      installer.indexOf('Source: "{#PayloadRoot}\\*"'),
    );
    const code = installer.split("[Code]")[1];
    expect(code).toContain("function PrepareToInstall(var NeedsRestart: Boolean): String;");
    expect(code).not.toMatch(/InitializeSetup|InitializeWizard|MsgBox|WizardForm/);
    expect(code).toContain("ExtractTemporaryFile('codexhost-install-helper.exe')");
    expect(code).toContain("ExpandConstant('{tmp}\\codexhost-install-helper.exe')");
    expect(code).toContain(
      "'prepare-install --install-root ' + AddQuotes(AddBackslash(ExpandConstant('{app}')) + '.')",
    );
    expect(code).toContain("ExecAndLogOutput(");
    expect(code).toContain("ewWaitUntilTerminated, ResultCode, nil");
    expect(code).toContain("else if ResultCode <> 0 then begin");
    expect(code).toContain("Could not close the running codexhost installation");
    expect(installer).not.toMatch(/CloseApplications\s*=\s*no/i);
    expect(installer).not.toMatch(/taskkill|powershell|\[Run\]/i);
  });

  it("runs service shutdown and autostart removal only during uninstall, before deleting files", async () => {
    const installer = await readFile(
      path.join(root, "scripts/release/windows/Installer.iss"),
      "utf8",
    );
    const uninstall = installer.split(/\[UninstallRun\]\r?\n/u)[1].split(/\r?\n\[/u)[0];
    expect(uninstall.trim().split(/\r?\n/u)).toEqual([
      'Filename: "{app}\\bin\\codexhost.exe"; Parameters: "stop"; Flags: runhidden; RunOnceId: "StopCodexhostServices"',
      'Filename: "{app}\\bin\\codexhost.exe"; Parameters: "autostart off"; Flags: runhidden; RunOnceId: "DisableCodexhostAutostart"',
    ]);
    expect(installer.split("[Code]")[1]).not.toMatch(/autostart|unins|Serve/u);
    expect(installer).not.toMatch(/\[Registry\]|RegDelete|taskkill|powershell/iu);
    expect(installer).toContain("UninstalledAll=%1 was successfully removed");
    expect(installer).toContain("Tailscale Serve configuration is still retained");
    expect(installer).toContain("tailscale serve --https=443 --set-path=/ off");
  });

  it("statically links the MSVC runtime so Windows executables need no VC++ Redistributable", async () => {
    const config = await readFile(path.join(root, ".cargo/config.toml"), "utf8");
    for (const target of ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"]) {
      expect(config).toContain(
        `[target.${target}]\nrustflags = ["-C", "target-feature=+crt-static"]`,
      );
    }
  });

  it.skipIf(process.platform !== "win32")(
    "reports missing Inno Setup without testing an empty compiler path",
    () => {
      const script = path.join(root, "scripts/release/windows/package.ps1").replaceAll("'", "''");
      const result = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `function Test-Path {
            param([string]$PathType, [string]$Path)
            if ([string]::IsNullOrEmpty($Path)) { throw "Unexpected empty compiler path" }
            return $false
          }
          & '${script}' -PayloadRoot . -OutputPath unused.exe -Version 0.0.0 -Architecture x64`,
        ],
        { encoding: "utf8", timeout: 15_000, windowsHide: true },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Install Inno Setup 6 before packaging.");
      expect(result.stderr).not.toContain("Unexpected empty compiler path");
    },
  );

  it("builds a standard Inno Setup installer for both Windows architectures", async () => {
    const [script, installer] = await Promise.all([
      readFile(path.join(root, "scripts/release/windows/package.ps1"), "utf8"),
      readFile(path.join(root, "scripts/release/windows/Installer.iss"), "utf8"),
    ]);
    expect(script).toContain('ValidateSet("x64", "arm64")');
    expect(script).toContain("Inno Setup 6\\ISCC.exe");
    expect(script).toContain("Inno Setup build");
    expect(installer).toContain("DefaultDirName={localappdata}\\Programs\\codexhost");
    expect(installer).toContain("PrivilegesRequired=lowest");
    expect(installer).toContain("DisableProgramGroupPage=yes");
    expect(installer.split(/\r?\n/)).toContain(
      'Name: "{userdesktop}\\codexhost"; Filename: "{app}\\bin\\codexhost-start.exe"; WorkingDir: "{app}"',
    );
    expect(installer).toContain("ArchitecturesAllowed=x64compatible");
    expect(installer).toContain("ArchitecturesAllowed=arm64");
  });
});
