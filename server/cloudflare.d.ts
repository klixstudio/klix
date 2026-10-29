// The one Workers runtime type worker.ts needs, without pulling the full Workers types into the Node build.
declare module 'cloudflare:workers' {
  export class DurableObject {
    protected ctx: {
      storage: {
        get<T = unknown>(key: string): Promise<T | undefined>;
        put(key: string, value: unknown): Promise<void>;
        put(entries: Record<string, unknown>): Promise<void>;
        deleteAll(): Promise<void>;
      };
    };
    constructor(ctx: unknown, env: unknown);
  }
}
