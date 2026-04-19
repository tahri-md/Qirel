import { describe, expect, it } from "vitest";
import { ResultMerger } from "../gateway/resultMerger.js";

describe("ResultMerger", () => {
    it("merges data from multiple subgraphs and prefixes errors", () => {
        const merger = new ResultMerger();

        const merged = merger.merge([
            {
                subgraphName: "users",
                data: {
                    user: {
                        __typename: "User",
                        id: "1",
                        name: "Ada",
                    },
                },
            },
            {
                subgraphName: "orders",
                data: {
                    user: {
                        __typename: "User",
                        id: "1",
                        orders: [{ id: "o-1" }],
                    },
                },
                errors: ["orders service timeout"],
            },
        ]);

        expect(merged.data.user).toEqual({
            __typename: "User",
            id: "1",
            name: "Ada",
            orders: [{ id: "o-1" }],
        });

        expect(merged.errors).toHaveLength(1);
        expect(merged.errors?.[0]?.message).toContain("[orders]");
    });

    it("resolves external references through stitched entities", () => {
        const merger = new ResultMerger();

        const merged = merger.merge([
            {
                subgraphName: "users",
                data: {
                    viewer: { __ref: "User:1" },
                },
            },
            {
                subgraphName: "users",
                data: {
                    user: {
                        __typename: "User",
                        id: "1",
                        name: "Ada",
                    },
                },
            },
        ]);

        expect(merged.data.viewer).toEqual({
            __typename: "User",
            id: "1",
            name: "Ada",
        });
    });
});
