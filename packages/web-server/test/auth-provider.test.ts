import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { AccessAuth, CredentialConnections } from "../src/auth.ts";
import { AccessTokenStore } from "../src/access-tokens.ts";
import { loadAuthenticationProvider, type AuthenticationProvider } from "../src/auth-provider.ts";
import { RequestTrust } from "../src/request-trust.ts";
import { DataDir } from "../src/store.ts";

test("authentication provider is explicit and validates its module contract", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "auth-provider-loader-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(await loadAuthenticationProvider(undefined, undefined), undefined);
  await assert.rejects(loadAuthenticationProvider(undefined, "/config"));
  await assert.rejects(loadAuthenticationProvider("relative.mjs", undefined));
  const module = join(root, "provider.mjs");
  writeFileSync(
    module,
    "export default () => ({ authenticate() {}, onRevoke() {}, dispose() {} });",
  );
  assert.ok(await loadAuthenticationProvider(module, undefined));
  const invalid = join(root, "invalid.mjs");
  writeFileSync(invalid, "export default () => ({});");
  await assert.rejects(loadAuthenticationProvider(invalid, undefined));
});

test("HTTP and WebSocket share remote provider identity, fail closed, expire and revoke", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "auth-provider-http-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let revoke: (credential?: string) => void = () => {};
  let expiry = 300_000;
  const provider: AuthenticationProvider = {
    authenticate(request) {
      const value = request.headers["x-test-provider"];
      if (value === undefined) return { status: "not-applicable" };
      if (value === "throws") throw new Error("provider failure");
      if (value !== "valid") return { status: "denied" };
      return {
        status: "authenticated",
        credential: "remote-session",
        expiresAt: Date.now() + expiry,
      };
    },
    onRevoke(listener) {
      revoke = listener;
    },
    dispose() {
      revoke();
    },
  };
  const tokens = new AccessTokenStore(new DataDir(root), { token: "generated-local-test-token" });
  const auth = new AccessAuth(
    tokens,
    new RequestTrust(undefined),
    new CredentialConnections(),
    provider,
  );
  const server = createServer((request, response) => {
    void auth.gate(request, response, (request.url ?? "/").split("?")[0] ?? "/").then((result) => {
      if (result.handled) return;
      if (request.url === "/stream") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("data: connected\n\n");
        return;
      }
      response.end(
        JSON.stringify({ credential: result.auth?.credential, local: result.auth?.local }),
      );
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (auth.admitUpgrade(request, socket))
      wss.handleUpgrade(request, socket, head, (ws) => ws.send("admitted"));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    auth.dispose();
    wss.close();
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = { "x-test-provider": "valid" };
  assert.equal((await fetch(base + "/api/auth/status")).status, 401);
  assert.deepEqual(await (await fetch(base + "/api/auth/status", { headers })).json(), {
    authenticated: true,
    local: false,
  });
  assert.deepEqual(await (await fetch(base + "/", { headers })).json(), {
    credential: "provider:remote-session",
    local: false,
  });
  assert.deepEqual(
    await (
      await fetch(base + "/api/auth/status", {
        headers: { authorization: "Bearer generated-local-test-token" },
      })
    ).json(),
    { authenticated: true, local: true },
  );
  for (const value of ["invalid", "throws"]) {
    const bad = { authorization: "Bearer generated-local-test-token", "x-test-provider": value };
    for (const path of ["/", "/assets/app.js", "/api/auth/login", "/api/auth/status"])
      assert.equal((await fetch(base + path, { headers: bad })).status, 401);
  }
  assert.equal((await fetch(base + "/api/auth/login", { method: "POST", headers })).status, 403);
  const ws = new WebSocket(base.replace("http:", "ws:") + "/events", { headers });
  t.after(() => ws.terminate());
  const message = once(ws, "message");
  await once(ws, "open");
  assert.equal(String((await message)[0]), "admitted");
  const stream = await fetch(base + "/stream", { headers });
  assert.ok(stream.body);
  const reader = stream.body.getReader();
  await reader.read();
  const ended = reader.read().catch(() => null);
  const closed = once(ws, "close");
  revoke("remote-session");
  await closed;
  await ended;
  expiry = 80;
  const expiring = new WebSocket(base.replace("http:", "ws:") + "/events", { headers });
  t.after(() => expiring.terminate());
  await once(expiring, "open");
  await once(expiring, "close");
  expiry = -1;
  assert.equal((await fetch(base + "/api/auth/status", { headers })).status, 401);
});
