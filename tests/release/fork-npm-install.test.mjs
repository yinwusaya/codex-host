import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createNpmMetaPackageManifest } from "../../scripts/release/prepare-npm-meta.mjs";
import { NPM_PLATFORM_PACKAGE_NAMES } from "../../scripts/release/prepare-npm.mjs";
import { hostReleaseTargetId } from "../../scripts/release/targets.mjs";

it("upgrades fork tarballs offline at the same prefix without resolving a stale nested payload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexhost-fork-install-"));
  const prefix = path.join(root, "custom prefix");
  const platformName = NPM_PLATFORM_PACKAGE_NAMES[hostReleaseTargetId()];
  const modules = path.join(
    prefix,
    ...(process.platform === "win32" ? [] : ["lib"]),
    "node_modules",
  );
  const cliRoot = path.join(modules, "@codexhost/cli");
  const environment = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: root,
    TMP: root,
    HOME: root,
    USERPROFILE: root,
    npm_config_userconfig: path.join(root, "user.npmrc"),
    npm_config_globalconfig: path.join(root, "global.npmrc"),
    npm_config_cache: path.join(root, "cache"),
  };
  const npm = (args, cwd = root) =>
    execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd,
      env: environment,
      encoding: "utf8",
      windowsHide: true,
    });
  try {
    expect(process.env.npm_execpath, "run this test through npm").toBeTruthy();
    await writeFile(environment.npm_config_userconfig, "");
    await writeFile(environment.npm_config_globalconfig, "");
    for (const version of ["1.0.0", "1.1.0"]) {
      const tarballs = [];
      for (const kind of ["cli", "platform"]) {
        const directory = path.join(root, `${kind}-${version}`);
        await mkdir(path.join(directory, "bin"), { recursive: true });
        const manifest =
          kind === "cli"
            ? createNpmMetaPackageManifest({ version, repository: "yinwusaya/codex-host" })
            : { name: platformName, version };
        await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest));
        await writeFile(path.join(directory, "bin/codexhost.js"), "// isolated fixture\n");
        const packed = JSON.parse(
          npm(["pack", "--json", "--ignore-scripts", "--offline"], directory),
        );
        tarballs.push(path.join(directory, packed[0].filename));
      }
      npm([
        "install",
        "--global",
        "--prefix",
        prefix,
        "--omit=optional",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...tarballs,
      ]);
      const require = createRequire(path.join(cliRoot, "bin/codexhost.js"));
      const platformManifest = JSON.parse(
        await readFile(require.resolve(`${platformName}/package.json`), "utf8"),
      );
      expect(platformManifest.version).toBe(version);
      expect(JSON.parse(await readFile(path.join(cliRoot, "package.json"), "utf8")).version).toBe(
        version,
      );
      if (version === "1.0.0") {
        const nested = path.join(cliRoot, "node_modules", platformName);
        await mkdir(nested, { recursive: true });
        await writeFile(
          path.join(nested, "package.json"),
          JSON.stringify({ name: platformName, version }),
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
