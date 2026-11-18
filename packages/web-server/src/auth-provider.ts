import type { IncomingMessage } from "node:http";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export type ProviderAdmission =
  | { status: "not-applicable" }
  | { status: "denied" }
  | { status: "authenticated"; credential: string; expiresAt: number };

/** Only explicitly configured server modules can participate in authentication. */
export interface AuthenticationProvider {
  authenticate(request: IncomingMessage): ProviderAdmission;
  onRevoke(listener: (credential?: string) => void): void;
  dispose(): void;
}

export async function loadAuthenticationProvider(
  modulePath: string | undefined,
  configFile: string | undefined,
): Promise<AuthenticationProvider | undefined> {
  if (modulePath === undefined) {
    if (configFile !== undefined)
      throw new Error("--auth-provider-config requires --auth-provider");
    return undefined;
  }
  if (!isAbsolute(modulePath) || (configFile !== undefined && !isAbsolute(configFile)))
    throw new Error("Authentication provider paths must be absolute");
  const module = (await import(pathToFileURL(modulePath).href)) as {
    default?: (options: {
      configFile?: string;
    }) => AuthenticationProvider | Promise<AuthenticationProvider>;
  };
  if (typeof module.default !== "function") throw new Error("Invalid authentication provider");
  const provider = await module.default({ ...(configFile === undefined ? {} : { configFile }) });
  if (
    !provider ||
    typeof provider.authenticate !== "function" ||
    typeof provider.onRevoke !== "function" ||
    typeof provider.dispose !== "function"
  )
    throw new Error("Invalid authentication provider contract");
  return provider;
}

export class ProviderConnections {
  private readonly active = new Set<{ credential: string; destroy(): void }>();

  constructor(readonly provider: AuthenticationProvider) {
    provider.onRevoke((credential) => {
      for (const entry of this.active)
        if (credential === undefined || entry.credential === credential) entry.destroy();
    });
  }

  authenticate(request: IncomingMessage): ProviderAdmission {
    try {
      const result = this.provider.authenticate(request);
      if (result.status === "not-applicable" || result.status === "denied") return result;
      if (
        result.status === "authenticated" &&
        typeof result.credential === "string" &&
        result.credential.length > 0 &&
        result.credential.length <= 256 &&
        Number.isFinite(result.expiresAt) &&
        result.expiresAt > Date.now()
      )
        return { ...result, expiresAt: Math.min(result.expiresAt, Date.now() + 300_000) };
    } catch {
      // A broken provider must not downgrade a signed request to another identity.
    }
    return { status: "denied" };
  }

  track(
    admission: Extract<ProviderAdmission, { status: "authenticated" }>,
    connection: { destroy(): unknown; once(event: "close", listener: () => void): unknown },
  ): () => void {
    const release = (): void => {
      clearTimeout(timer);
      this.active.delete(entry);
    };
    const entry = {
      credential: admission.credential,
      destroy: (): void => {
        release();
        connection.destroy();
      },
    };
    const timer = setTimeout(entry.destroy, Math.max(1, admission.expiresAt - Date.now()));
    timer.unref();
    this.active.add(entry);
    connection.once("close", release);
    return release;
  }

  dispose(): void {
    for (const entry of this.active) entry.destroy();
    this.provider.dispose();
  }
}
