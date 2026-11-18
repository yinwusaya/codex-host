import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WebProductBundleIsolation } from "../../apps/web-ui/scripts/web-product-bundle-isolation.ts";

let root;
let web;
let isolation;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "web-product-isolation-"));
  web = join(root, "web");
  mkdirSync(web);
  writeFileSync(join(web, "index.html"), "");
  writeFileSync(join(web, "entry.js"), "");
  isolation = new WebProductBundleIsolation(root, web);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function chunk(fileName, modules, extra = {}) {
  return {
    type: "chunk",
    fileName,
    facadeModuleId: null,
    modules: Object.fromEntries(modules.map((id) => [id, {}])),
    imports: [],
    dynamicImports: [],
    ...extra,
  };
}

function bundle(extra = {}) {
  isolation.assetReference("entry.js", "index.html", "asset");
  return {
    "index.html": {
      type: "asset",
      fileName: "index.html",
      names: ["index.html"],
      originalFileNames: ["index.html"],
    },
    "entry.js": chunk("entry.js", [join(web, "entry.js")], extra),
  };
}

function moduleInfo() {
  return { importedIds: [], dynamicallyImportedIds: [] };
}

it.each(["Rolldown", "Rollup"])("accepts %s output chunk metadata", (backend) => {
  const output = bundle(
    backend === "Rollup" ? { implicitlyLoadedBefore: [], referencedFiles: [] } : {},
  );
  isolation.captureChunks(output);
  expect(() => isolation.verify(output, moduleInfo)).not.toThrow();
});

it.each(["imports", "dynamicImports", "implicitlyLoadedBefore", "referencedFiles"])(
  "rejects experimental chunks reachable through %s",
  (edge) => {
    const output = bundle({ implicitlyLoadedBefore: [], referencedFiles: [], [edge]: ["bad.js"] });
    output["bad.js"] = chunk("bad.js", [join(root, "packages/experimental/entry.js")], {
      implicitlyLoadedBefore: [],
      referencedFiles: [],
    });
    isolation.captureChunks(output);
    expect(() => isolation.verify(output, moduleInfo)).toThrow("experimental input");
  },
);

it("checks retained CSS inputs when the bundler omits module inclusion flags", () => {
  const output = bundle();
  const css = join(web, "style.css");
  writeFileSync(css, "");
  isolation.cssTransform(css);
  isolation.cssDependency(css, join(root, "packages/experimental/tokens.css"));
  isolation.captureChunks({ ...output, "style.js": chunk("style.js", [css]) });
  expect(() =>
    isolation.verify(output, (id) => ({
      importedIds: id === join(web, "entry.js") ? [css] : [],
      dynamicallyImportedIds: [],
    })),
  ).toThrow("experimental input");
});

it.each(["\0rolldown/runtime.js", "\0unknown-module"])(
  "only permits the bundler runtime to omit its module record: %s",
  (id) => {
    const output = bundle();
    output["entry.js"].modules[id] = {};
    isolation.captureChunks(output);
    const verify = () =>
      isolation.verify(output, (module) =>
        module === id ? null : { importedIds: [id], dynamicallyImportedIds: [] },
      );
    if (id === "\0rolldown/runtime.js") expect(verify).not.toThrow();
    else expect(verify).toThrow("has no Rollup module record");
  },
);
