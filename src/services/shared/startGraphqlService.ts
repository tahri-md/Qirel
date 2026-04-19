import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import type { Server } from "http";

type ServiceConfig = {
    name: string;
    port: number;
    typeDefs: string;
    resolvers: unknown;
};

export type StartedService = {
    name: string;
    port: number;
    stop: () => Promise<void>;
};

export async function startGraphqlService(config: ServiceConfig): Promise<StartedService> {
    const app = express();
    app.use(express.json());
    app.use(cors());
    app.use(bodyParser.json());

    const apollo = new ApolloServer({
        typeDefs: config.typeDefs,
        resolvers: config.resolvers as any,
    });

    await apollo.start();
    app.use("/graphql", expressMiddleware(apollo));

    const httpServer = await new Promise<Server>((resolve) => {
        const server = app.listen(config.port, () => {
            console.log(`[${config.name}] running on port ${config.port}`);
            resolve(server);
        });
    });

    return {
        name: config.name,
        port: config.port,
        stop: async () => {
            await new Promise<void>((resolve, reject) => {
                httpServer.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve();
                });
            });

            await apollo.stop();
        },
    };
}
