import { startGraphqlService, type StartedService } from "../shared/startGraphqlService.js";

type User = {
    id: string;
    name: string;
    email: string;
};

const users: User[] = [];

const typeDefs = `#graphql
    type User {
        id: ID!
        name: String!
        email: String!
    }

    type Query {
        user(id: ID!): User
        users: [User!]!
    }

    type Mutation {
        createUser(id: ID!, name: String!, email: String!): User!
    }
`;

const resolvers = {
    Query: {
        user: (_: unknown, args: { id: string }) => users.find((user) => user.id === args.id) ?? null,
        users: () => users,
    },
    Mutation: {
        createUser: (_: unknown, args: { id: string; name: string; email: string }) => {
            const user = { id: args.id, name: args.name, email: args.email };
            users.push(user);
            return user;
        },
    },
};

export async function startUsersService(port = 4001): Promise<StartedService> {
    return startGraphqlService({
        name: "users-service",
        port,
        typeDefs,
        resolvers,
    });
}
