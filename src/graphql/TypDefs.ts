export const typeDefs = `#graphql
  scalar JSON

  type GatewayError {
    message: String!
  }

  type GatewayExtensions {
    duration: Int!
    subgraphCalls: Int!
    cacheHit: Boolean!
    traceId: String!
  }

  type GatewayResponse {
    data: JSON!
    errors: [GatewayError!]
    extensions: GatewayExtensions!
  }

  type Query {
    hello: String!
    health: String!
    gateway(
      query: String!
      variables: JSON
      operationName: String
    ): GatewayResponse!
  }
`;