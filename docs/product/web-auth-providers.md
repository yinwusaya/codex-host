# Web Authentication Providers

The Web gateway accepts one optional, administrator-selected authentication module. It is separate from Web UI extensions and Harness plugins: enabling a UI plugin never grants authentication authority. The core has no dependency on any manager, key format, or signature protocol.

## Configuration

Start the Node Web entry with absolute paths:

```sh
node --import tsx packages/web-server/src/main.ts \
  --auth-provider /absolute/plugins/manager-access.mjs \
  --auth-provider-config /absolute/public-trust.json
```

For an installed background Web, save these options with its Node entry before the next authorized Web restart:

```sh
node /absolute/app/web-server.mjs --data /absolute/web-data \
  --save-service-options \
  --auth-provider /absolute/plugins/manager-access.mjs \
  --auth-provider-config /absolute/public-trust.json
```

Exit code 42 means settings changed, 0 means unchanged, and 1 means invalid. The native `codexhost web` argument parser is unchanged: use the Node entry for these two options. The background server restores the saved paths from `service.json`. Empty option values clear them. No module is loaded by the save-only command. These options cannot be combined with `--no-auth`. Invalid modules prevent startup; they are never silently skipped. Disabling a provider requires an authorized Web restart, which disconnects its clients but does not stop the shared Host.

## Contract

The module exports a default factory accepting `{ configFile?: string }`. It returns an object conforming to `AuthenticationProvider` in `packages/web-server/src/auth-provider.ts`:

```ts
{
  authenticate(request):
    | { status: "not-applicable" }
    | { status: "denied" }
    | { status: "authenticated", credential: string, expiresAt: number };
  onRevoke(listener: (credential?: string) => void): void;
  dispose(): void;
}
```

Authentication is synchronous and runs before ordinary HTTP authentication, including public assets, and during WebSocket admission. `not-applicable` preserves the existing Cookie/Bearer flow. `denied`, thrown exceptions, malformed results, and expired admissions reject the request without trying another identity. The factory may initialize asynchronously.

The core prefixes provider credentials with `provider:`, always sets HTTP `RequestAuth.local` to `false`, and never issues or renews an access-token cookie for the provider. Provider requests cannot read or regenerate the Web access token. Signed requests to the ordinary cookie endpoints are rejected. Existing origin checks remain enforced; the provider cannot mark forwarding headers trusted or grant local status. A provider is trusted server code, not a sandbox: only install an administrator-reviewed module.

Providers may opt in to browser sign-in with `browserLogin` and `browserLogout`. The trusted
HTTPS-only `POST /api/auth/provider/login` route delegates proof and exact issuer-origin
validation to the provider. A successful reply sets the provider's own cookie and redirects
only to the device root (optionally with a query). Authentication receives the core's trusted
HTTPS verdict as its second argument, for use when admitting provider cookies. Same-origin
`POST /api/auth/logout` may revoke and clear a browser provider session, without granting
signed proxy requests access to this operation.

Each admitted HTTP response and upgraded socket is tracked until close or release. The core caps connection admission at five minutes for request proofs, or eight hours for `browserSession: true` admissions over trusted HTTPS, and never beyond the provider's expiration. Expiration destroys the connection; existing clients can reconnect through normal authentication. The provider calls its revocation listener with one credential or no argument for all of its connections. Disposing the core wrapper destroys all tracked connections and disposes the provider.

## Independent Manager Plugin

`manager-access` lives in the separate CodexHost Manager project, not in this core. It verifies per-device Ed25519 public trust, short-lived request proofs, exact methods and targets, manager Origin and mount, and one-time nonces. The manager retains only its own generated private keys, never existing device tokens. Its deployment, rotation, direct sign-in, proxy compatibility, and isolated checks are documented in that project's README. Direct access without a recognized provider session retains the original token authentication.

The proxy still uses its existing path compatibility bridge. This provider does not add native mount-path support, PWA proxy support, separate browser Origins, model validation, or automatic production deployment.
