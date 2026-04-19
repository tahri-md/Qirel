import { startGraphqlService, type StartedService } from "../shared/startGraphqlService.js";

type Order = {
    id: string;
    userId: string;
    total: number;
    status: string;
};

const orders: Order[] = [];

const typeDefs = `#graphql
    type Order {
        id: ID!
        userId: ID!
        total: Float!
        status: String!
    }

    type Query {
        order(id: ID!): Order
        orders(userId: ID): [Order!]!
    }

    type Mutation {
        createOrder(id: ID!, userId: ID!, total: Float!, status: String!): Order!
    }
`;

const resolvers = {
    Query: {
        order: (_: unknown, args: { id: string }) => orders.find((order) => order.id === args.id) ?? null,
        orders: (_: unknown, args: { userId?: string }) => {
            if (!args.userId) {
                return orders;
            }
            return orders.filter((order) => order.userId === args.userId);
        },
    },
    Mutation: {
        createOrder: (_: unknown, args: { id: string; userId: string; total: number; status: string }) => {
            const order = { id: args.id, userId: args.userId, total: args.total, status: args.status };
            orders.push(order);
            return order;
        },
    },
};

export async function startOrdersService(port = 4002): Promise<StartedService> {
    return startGraphqlService({
        name: "orders-service",
        port,
        typeDefs,
        resolvers,
    });
}
