import { DomainError } from "../domain/errors.js";
import {
  assertAuthority,
  assertTenant,
  type AuthorityVersion,
  type TenantIdentity,
  type TenantSnapshot,
} from "../domain/tenant.js";
import type { ConnectionPorts, SqlSession, TenantDatabase } from "./database-ports.js";

/** Owns the pool and write lease; callers never select a database. */
export class ConnectionManager {
  private pool?: TenantDatabase;
  private snapshot?: TenantSnapshot;
  private authority?: AuthorityVersion;
  private refreshing?: Promise<void>;
  private available = false;
  private schemaReady = false;
  private schemaBusy = false;
  constructor(
    readonly identity: TenantIdentity,
    private readonly ports: ConnectionPorts,
  ) {}
  get connected() {
    return this.available && !!this.snapshot && Date.parse(this.snapshot.leaseUntil) > Date.now();
  }
  get provisioned() {
    return this.connected && this.schemaReady && !this.schemaBusy;
  }
  get ready() {
    return (
      this.connected && this.schemaReady && !this.schemaBusy && this.snapshot?.status === "READY"
    );
  }
  get fencingToken() {
    return this.snapshot?.fencingToken;
  }
  get upgrading() {
    return this.schemaBusy;
  }
  setSchemaReady(value: boolean) {
    this.schemaReady = value;
  }
  setSchemaBusy(value: boolean) {
    this.schemaBusy = value;
  }
  refresh(): Promise<void> {
    this.refreshing ??= this.reload().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  private async reload(): Promise<void> {
    try {
      const next = await this.ports.snapshot();
      this.authority ??= await this.ports.readAuthority();
      assertTenant(next, this.identity);
      assertAuthority(next, this.authority);
      if (!this.sameConnection(next)) await this.replacePool(next);
      await this.pool!.verifyIdentity();
      await this.ports.saveAuthority(next);
      this.authority = next;
      this.snapshot = next;
      this.available = true;
    } catch (error) {
      this.available = false;
      throw error;
    }
  }
  private sameConnection(next: TenantSnapshot): boolean {
    const old = this.snapshot;
    return (
      !!this.pool &&
      !!old &&
      [
        "host",
        "port",
        "database",
        "user",
        "passwordEnvelope",
        "credentialVersion",
        "fencingToken",
      ].every((key) => old[key as keyof TenantSnapshot] === next[key as keyof TenantSnapshot])
    );
  }
  private async replacePool(snapshot: TenantSnapshot): Promise<void> {
    this.available = false;
    const candidate = await this.ports.open(snapshot, await this.ports.decrypt(snapshot));
    try {
      await candidate.verifyIdentity();
    } catch (error) {
      await candidate.close();
      throw error;
    }
    const previous = this.pool;
    this.pool = candidate;
    this.schemaReady = false;
    await previous?.close();
  }
  database(): TenantDatabase {
    if (!this.connected || !this.pool) throw new DomainError("NOT_READY");
    return this.pool;
  }
  async assertWriteAuthority(business = false): Promise<void> {
    try {
      const actual = await this.ports.snapshot();
      assertTenant(actual, this.identity);
      assertAuthority(actual, this.authority);
      if (business && actual.status !== "READY") throw new DomainError("TENANT_UNAVAILABLE");
      if (
        !this.snapshot ||
        actual.fencingToken !== this.snapshot.fencingToken ||
        actual.credentialVersion !== this.snapshot.credentialVersion ||
        !this.sameConnection(actual)
      )
        throw new DomainError("AUTHORITY_CHANGED");
    } catch (error) {
      this.available = false;
      throw error;
    }
  }
  private assertPool(pool: TenantDatabase, business: boolean): void {
    if (this.pool !== pool || !this.connected) throw new DomainError("AUTHORITY_CHANGED");
    if (business && !this.ready)
      throw new DomainError(this.schemaBusy ? "TENANT_SCHEMA_UPGRADING" : "NOT_READY");
  }
  async guard(pool: TenantDatabase, business = false): Promise<void> {
    this.assertPool(pool, business);
    await this.assertWriteAuthority(business);
    this.assertPool(pool, business);
  }
  async write<T>(work: (session: SqlSession) => Promise<T>): Promise<T> {
    const pool = this.database();
    await this.guard(pool, true);
    return pool.transaction(
      async (session) => {
        await this.guard(pool, true);
        return work(session);
      },
      () => this.guard(pool, true),
    );
  }
  async close(): Promise<void> {
    this.available = false;
    await this.pool?.close();
  }
}
