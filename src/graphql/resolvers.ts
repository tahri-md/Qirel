import { RequestHandler } from "../core/gateway/requestHandler.js";
import { QueryPlanner } from "../core/planner/QueryPlanner.js";

const planner = new QueryPlanner();
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