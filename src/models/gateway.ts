import type { GraphQLError } from "graphql";

export interface GatewayRequest {
  query: string;
  variables?: Record<string, any>;
  operationName?: string;
  userId?: string;
  permissions?: string[];
  headers?: Record<string, string>;
}

export interface GatewayResponse {
  data: Record<string, any>;
  errors?: GraphQLError[];
  extensions: {
    duration: number;
    subgraphCalls: number;
    cacheHit: boolean;
    traceId: string;
  };
}