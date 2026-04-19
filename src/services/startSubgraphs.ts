import { startUsersService } from "./users/server.js";
import { startOrdersService } from "./orders/server.js";
import { startProductsService } from "./products/server.js";
import type { StartedService } from "./shared/startGraphqlService.js";

function readPortFromUrl(envValue: string | undefined, fallback: number): number {
    if (!envValue) {
        return fallback;
    }

    try {
        const parsed = new URL(envValue);
        return parsed.port ? Number(parsed.port) : fallback;
    } catch {
        return fallback;
    }
}

async function stopAll(services: StartedService[]): Promise<void> {
    for (const service of services) {
        await service.stop();
        console.log(`[${service.name}] stopped`);
    }
}

async function main(): Promise<void> {
    const usersPort = readPortFromUrl(process.env.USERS_SERVICE_URL, 4001);
    const ordersPort = readPortFromUrl(process.env.ORDERS_SERVICE_URL, 4002);
    const productsPort = readPortFromUrl(process.env.PRODUCTS_SERVICE_URL, 4003);

    const services = await Promise.all([
        startUsersService(usersPort),
        startOrdersService(ordersPort),
        startProductsService(productsPort),
    ]);

    console.log("Subgraph services started:", services.map((service) => `${service.name}@${service.port}`).join(", "));

    const shutdown = async () => {
        await stopAll(services);
        process.exit(0);
    };

    process.on("SIGINT", () => {
        void shutdown();
    });

    process.on("SIGTERM", () => {
        void shutdown();
    });
}

void main();
