import { writeFile } from "node:fs/promises";

const semverPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const targetPattern = /^(?:macos|windows|linux)-(?:arm64|x64)$/u;

export function createDistributionMetadata({ version, distribution, target, repository, commit }) {
  if (!semverPattern.test(version)) throw new Error("distribution version must be valid semver");
  if (distribution !== "installer" && distribution !== "npm") {
    throw new Error("distribution must be installer or npm");
  }
  if (!targetPattern.test(target)) throw new Error("distribution target is invalid");
  if (
    repository !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(repository)
  ) {
    throw new Error("distribution repository must be owner/repo");
  }
  if (commit !== undefined && !/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("distribution commit must be a full SHA");
  }
  if ((repository === undefined) !== (commit === undefined)) {
    throw new Error("distribution repository and commit must be provided together");
  }
  return {
    schemaVersion: 1,
    version,
    distribution,
    target,
    ...(repository === undefined ? {} : { repository, commit }),
  };
}

export async function writeDistributionMetadata(filePath, options) {
  const metadata = createDistributionMetadata({
    repository: process.env.CODEXHOST_RELEASE_REPOSITORY,
    commit: process.env.CODEXHOST_RELEASE_COMMIT,
    ...options,
  });
  await writeFile(filePath, `${JSON.stringify(metadata)}\n`, { encoding: "utf8", mode: 0o600 });
  return metadata;
}
