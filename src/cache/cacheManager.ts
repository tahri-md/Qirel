type CacheEntry = {
    value: any;
    expiresAt: number | null;
};

export class CacheManager {
    private readonly store = new Map<string, CacheEntry>();

    async get(key: string): Promise<any> {
        const entry = this.store.get(key);
        if (!entry) {
            return null;
        }

        if (this.isExpired(entry)) {
            this.store.delete(key);
            return null;
        }

        return entry.value;
    }

    async set(key: string, value: any, ttl: number): Promise<void> {
        const expiresAt = this.resolveExpiresAt(ttl);

        if (expiresAt !== null && expiresAt <= Date.now()) {
            this.store.delete(key);
            return;
        }

        this.store.set(key, {
            value,
            expiresAt,
        });
    }

    async invalidate(pattern: string): Promise<void> {
        if (!pattern || pattern === "*") {
            this.store.clear();
            return;
        }

        const matcher = this.toPatternRegex(pattern);

        for (const key of this.store.keys()) {
            if (matcher.test(key)) {
                this.store.delete(key);
            }
        }
    }

    async getFieldCache(type: string, id: string, field: string): Promise<any> {
        return this.get(this.buildFieldKey(type, id, field));
    }

    async setFieldCache(
        type: string,
        id: string,
        field: string,
        value: any,
        ttl: number
    ): Promise<void> {
        await this.set(this.buildFieldKey(type, id, field), value, ttl);
    }

    private buildFieldKey(type: string, id: string, field: string): string {
        return `${type}:${id}:${field}`;
    }

    private isExpired(entry: CacheEntry): boolean {
        if (entry.expiresAt === null) {
            return false;
        }

        return Date.now() >= entry.expiresAt;
    }

    private resolveExpiresAt(ttl: number): number | null {
        if (!Number.isFinite(ttl)) {
            return null;
        }

        const ttlMs = Math.floor(ttl * 1000);
        if (ttlMs <= 0) {
            return Date.now();
        }

        return Date.now() + ttlMs;
    }

    private toPatternRegex(pattern: string): RegExp {
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
        const wildcardPattern = escaped.replace(/\*/g, ".*");
        return new RegExp(`^${wildcardPattern}$`);
    }
}