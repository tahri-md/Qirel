import { describe, expect, it } from "vitest";
import { QueryPlanner, type SubgraphSchema } from "../core/planner/QueryPlanner.js";

const subgraphSchema: SubgraphSchema = {
    users: {
        fields: {
            user: { type: "User", expectedResponseTime: 100 },
        },
    },
    orders: {
        fields: {
            orders: { type: "[Order]", expectedResponseTime: 180 },
        },
    },
    products: {
        fields: {
            products: { type: "[Product]", expectedResponseTime: 150 },
        },
    },
};

describe("QueryPlanner", () => {
    it("generates operations with non-empty query and fields", () => {
        const planner = new QueryPlanner(subgraphSchema);

        const plan = planner.plan(`
            query GetDashboard($userId: ID!) {
                user(id: $userId) {
                    id
                    name
                    orders {
                        id
                        total
                    }
                }
                products {
                    id
                    name
                }
            }
        `, {
            userId: "u-1",
        });

        const operations = plan.stages.flatMap((stage) => stage.operations);

        expect(operations.length).toBeGreaterThan(0);

        for (const operation of operations) {
            expect(operation.query.trim().length).toBeGreaterThan(0);
            expect(operation.fields.length).toBeGreaterThan(0);
        }

        expect(plan.dependencies.get("orders")?.has("users")).toBe(true);
    });
});
