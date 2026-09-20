export interface UpstreamCredential {
  name: string;
  headers: Record<string, string>;
  hmac?: { secret: string; keyId?: string; headerNamespace?: string };
}

export class UpstreamCredentialStore {
  private readonly credentials = new Map<string, UpstreamCredential>();

  constructor(credentials: UpstreamCredential[] = []) {
    for (const credential of credentials) {
      if (this.credentials.has(credential.name)) {
        throw new Error(`ERR_CREDENTIAL_DUPLICATE: ${credential.name}`);
      }
      this.credentials.set(credential.name, credential);
    }
  }

  get(name: string): UpstreamCredential | null {
    return this.credentials.get(name) ?? null;
  }

  resolveHeaderValues(name: string): Record<string, string> | null {
    return this.credentials.get(name)?.headers ?? null;
  }

  getHmacSecret(name: string): { secret: string; keyId?: string; headerNamespace?: string } | null {
    return this.credentials.get(name)?.hmac ?? null;
  }

  rotate(name: string, next: UpstreamCredential): boolean {
    if (!this.credentials.has(name)) return false;
    this.credentials.set(name, next);
    return true;
  }

  stats(): { credentials: number; withHmac: number } {
    let withHmac = 0;
    for (const credential of this.credentials.values()) {
      if (credential.hmac) withHmac += 1;
    }
    return { credentials: this.credentials.size, withHmac };
  }
}
