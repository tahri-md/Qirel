import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheManager } from "../cache/cacheManager.js";

describe("CacheManager", () => {
    let cache: CacheManager;

    beforeEach(() => {
        cache = new CacheManager();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("stores and retrieves values by key", async () => {
        await cache.set("user:1", { id: "1", name: "Ada" }, 30);

        const value = await cache.get("user:1");

        expect(value).toEqual({ id: "1", name: "Ada" });
    });

    it("expires values when ttl has elapsed", async () => {
        vi.useFakeTimers();

        await cache.set("token:abc", "active", 1);
        vi.advanceTimersByTime(1001);

        const value = await cache.get("token:abc");

        expect(value).toBeNull();
    });

    it("invalidates matching wildcard patterns", async () => {
        await cache.set("user:1:name", "Ada", 30);
        await cache.set("user:2:name", "Lin", 30);
        await cache.set("product:1:name", "Chair", 30);

        await cache.invalidate("user:*");

        expect(await cache.get("user:1:name")).toBeNull();
        expect(await cache.get("user:2:name")).toBeNull();
        expect(await cache.get("product:1:name")).toBe("Chair");
    });

    it("supports field-level get/set helpers", async () => {
        await cache.setFieldCache("User", "42", "profile", { age: 29 }, 60);

        const value = await cache.getFieldCache("User", "42", "profile");

        expect(value).toEqual({ age: 29 });
    });
});
