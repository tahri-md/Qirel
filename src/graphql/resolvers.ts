import { GraphQLScalarType, Kind } from "graphql";
import { RequestHandler } from "../core/gateway/requestHandler.js";
import { QueryPlanner, type SubgraphSchema } from "../core/planner/QueryPlanner.js";
import { env } from "../configs/env.js";
import { gatewayMetrics } from "../monitoring/metrics.js";

type ResolverContext = {
  headers: Record<string, string>;
  traceId: string;
};

type GatewayArgs = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

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
const handler = new RequestHandler(
  Number(env.REQUEST_TIMEOUT_MS) || 5000,
  Number(env.RETRY_COUNT) || 0,
  planner
);

const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  description: "Arbitrary JSON value",
  serialize(value: unknown): unknown {
    return value;
  },
  parseValue(value: unknown): unknown {
    return value;
  },
  parseLiteral(ast): unknown {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
      case Kind.FLOAT:
        return Number(ast.value);
      case Kind.NULL:
        return null;
      case Kind.OBJECT: {
        const value: Record<string, unknown> = {};
        for (const field of ast.fields) {
          value[field.name.value] = JSONScalar.parseLiteral(field.value, {});
        }
        return value;
      }
      case Kind.LIST:
        return ast.values.map((node) => JSONScalar.parseLiteral(node, {}));
      default:
        return null;
    }
  },
});

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export const resolvers = {
  JSON: JSONScalar,
  Query: {
    hello: () => "Hello from Qirel Gateway",
    health: () => "Gateway is alive",

    gateway: async (_: unknown, args: GatewayArgs, context: ResolverContext) => {
      const startedAt = Date.now();

      try {
        const requestPayload: {
          query: string;
          headers: Record<string, string>;
          variables?: Record<string, unknown>;
          operationName?: string;
        } = {
          query: args.query,
          headers: context.headers,
        };

        if (args.variables !== undefined) {
          requestPayload.variables = args.variables;
        }

        if (args.operationName !== undefined) {
          requestPayload.operationName = args.operationName;
        }

        const response = await handler.handleRequest(requestPayload);

        gatewayMetrics.recordGatewayRequest({
          durationMs: response.extensions.duration,
          subgraphCalls: response.extensions.subgraphCalls,
          cacheHit: response.extensions.cacheHit,
          hasError: Boolean(response.errors?.length),
        });

        return {
          data: response.data,
          errors: response.errors?.map((error) => ({ message: error.message })),
          extensions: response.extensions,
        };
      } catch (error) {
        const duration = Date.now() - startedAt;

        gatewayMetrics.recordGatewayRequest({
          durationMs: duration,
          subgraphCalls: 0,
          cacheHit: false,
          hasError: true,
        });

        return {
          data: {},
          errors: [{ message: readErrorMessage(error) }],
          extensions: {
            duration,
            subgraphCalls: 0,
            cacheHit: false,
            traceId: context.traceId,
          },
        };
      }
    },
  },
};