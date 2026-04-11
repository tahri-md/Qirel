import bodyParser from 'body-parser';
import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { typeDefs } from './graphql/TypDefs.js';
import { resolvers } from './graphql/resolvers.js';
import { env } from './configs/env.js';

export async function startServer() {
    const app = express();
    app.use(express.json());
    app.use(cors());
    app.use(bodyParser.json());

    const server = new ApolloServer({
        typeDefs,
        resolvers,
    });
    await server.start();
    app.use('/graphql', expressMiddleware(server));

    app.listen(env.PORT, () => {
        console.log(`Gateway is running on port ${env.PORT}`);
    });

}
