import { RequestHandler } from "../core/gateway/requestHandler.js";
import { QueryPlanner, type SubgraphSchema } from "../core/planner/QueryPlanner.js";

const subgraphSchema: SubgraphSchema = {
  users: {
    fields: {
      user: { type: "User", expectedResponseTime: 100 },
      users: { type: "[User]", expectedResponseTime: 150 },
    },
  },
  orders: {
    fields: {
      order: { type: "Order", expectedResponseTime: 120 },
      orders: { type: "[Order]", expectedResponseTime: 200 },
    },
  },
  products: {
    fields: {
      product: { type: "Product", expectedResponseTime: 80 },
      products: { type: "[Product]", expectedResponseTime: 180 },
    },
  },
};

const planner = new QueryPlanner(subgraphSchema);
const handler = new RequestHandler(5000, 3, planner);

export const resolvers = {
  Query: {
    health: () => "Gateway is alive",

    gateway: async (_: any, args: { query: string }) => {
      return handler.handleRequest({
        query: args.query,
      });
    },
  },
};