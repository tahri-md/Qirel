import { startGraphqlService, type StartedService } from "../shared/startGraphqlService.js";

type Product = {
    id: string;
    name: string;
    price: number;
    sku: string;
};

const products: Product[] = [];

const typeDefs = `#graphql
    type Product {
        id: ID!
        name: String!
        price: Float!
        sku: String!
    }

    type Query {
        product(id: ID!): Product
        products: [Product!]!
    }

    type Mutation {
        createProduct(id: ID!, name: String!, price: Float!, sku: String!): Product!
    }
`;

const resolvers = {
    Query: {
        product: (_: unknown, args: { id: string }) => products.find((product) => product.id === args.id) ?? null,
        products: () => products,
    },
    Mutation: {
        createProduct: (_: unknown, args: { id: string; name: string; price: number; sku: string }) => {
            const product = { id: args.id, name: args.name, price: args.price, sku: args.sku };
            products.push(product);
            return product;
        },
    },
};

export async function startProductsService(port = 4003): Promise<StartedService> {
    return startGraphqlService({
        name: "products-service",
        port,
        typeDefs,
        resolvers,
    });
}
