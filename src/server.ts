import bodyParser from 'body-parser';
import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import type { IncomingHttpHeaders } from 'http';
import { typeDefs } from './graphql/TypDefs.js';
import { resolvers } from './graphql/resolvers.js';
import { env } from './configs/env.js';
import { gatewayMetrics } from './monitoring/metrics.js';

const subgraphURLs: Record<string, string> = {
    users: env.USERS_SERVICE_URL,
    orders: env.ORDERS_SERVICE_URL,
    products: env.PRODUCTS_SERVICE_URL,
};

type SubgraphHealth = {
    status: 'up' | 'down';
    latency: string;
};

function createTraceId(): string {
    return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
            normalized[key.toLowerCase()] = value.join(',');
            continue;
        }

        if (typeof value === 'string') {
            normalized[key.toLowerCase()] = value;
        }
    }

    return normalized;
}

async function checkSubgraph(url: string): Promise<{ up: boolean; latencyMs: number }> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, 2000);

    try {
        const response = await fetch(`${url}/graphql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'query HealthProbe { __typename }' }),
            signal: controller.signal,
        });

        return {
            up: response.status < 500,
            latencyMs: Date.now() - startedAt,
        };
    } catch {
        return {
            up: false,
            latencyMs: Date.now() - startedAt,
        };
    } finally {
        clearTimeout(timeout);
    }
}

export async function startServer() {
    const app = express();
    app.use(express.json());
    app.use(cors());
    app.use(bodyParser.json());

    app.get('/health', async (_req, res) => {
        const checks = await Promise.all(
            Object.entries(subgraphURLs).map(async ([name, url]) => {
                const status = await checkSubgraph(url);
                gatewayMetrics.recordSubgraphHealth(name, status.up, status.latencyMs);

                return [
                    name,
                    {
                        status: status.up ? 'up' : 'down',
                        latency: `${status.latencyMs}ms`,
                    } satisfies SubgraphHealth,
                ] as const;
            })
        );

        const subgraphs = Object.fromEntries(checks) as Record<string, SubgraphHealth>;
        const allUp = Object.values(subgraphs).every((subgraph) => subgraph.status === 'up');

        res.status(allUp ? 200 : 503).json({
            status: allUp ? 'healthy' : 'degraded',
            gateway: 'ready',
            subgraphs,
            cache: {
                connected: true,
                memoryUsage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
            },
        });
    });

    app.get('/metrics', (_req, res) => {
        res.type('text/plain').send(gatewayMetrics.renderPrometheusMetrics());
    });

    const server = new ApolloServer({
        typeDefs,
        resolvers,
    });
    await server.start();
    app.use(
        '/graphql',
        expressMiddleware(server, {
            context: async ({ req }) => {
                const headers = normalizeHeaders(req.headers);
                const traceId = headers['x-trace-id'] || createTraceId();
                headers['x-trace-id'] = traceId;

                return {
                    headers,
                    traceId,
                };
            },
        })
    );

    app.listen(env.PORT, () => {
        console.log(`Gateway is running on port ${env.PORT}`);
    });

}
