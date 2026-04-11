import { z } from 'zod';

const envSchema = z.object({
    PORT: z.string().default('4000'),
    REQUEST_TIMEOUT_MS: z.string().default('5000'),
    RETRY_COUNT: z.string().default('3'),
    SECRET_KEY: z.string().min(1, "SECRET_KEY is required"),
    USERS_SERVICE_URL: z.string().default('http://localhost:4001'),
    ORDERS_SERVICE_URL: z.string().default('http://localhost:4002'),
    PRODUCTS_SERVICE_URL: z.string().default('http://localhost:4003'),
});

type EnvConfig = z.infer<typeof envSchema>;

export const env: EnvConfig = envSchema.parse(process.env);