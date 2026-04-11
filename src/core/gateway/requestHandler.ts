import jwt from "jsonwebtoken";
import type { GatewayRequest, GatewayResponse } from "../../models/gateway.js";
import type { QueryPlanner, PlanStep, ExecutionPlan } from "../planner/QueryPlanner.js";
import { env } from "../../configs/env.js";

export class RequestHandler {
    private requestTimeout: number;
    private retryCount: number;
    private planner: QueryPlanner;

    constructor(requestTimeout: number, retryCount: number, planner: QueryPlanner) {
        this.requestTimeout = requestTimeout;
        this.retryCount = retryCount;
        this.planner = planner;
    }

    async handleRequest(request: GatewayRequest): Promise<GatewayResponse> {
        this.validateRequest(request);
        this.authenticateRequest(request);
        const plan = this.planner.plan(request.query);
        const response = await this.executePlan(plan, request);
        return response;
    }

    private validateRequest(request: GatewayRequest): void {
        if (!request) {
            throw new Error("Request is required");
        }

        if (!request.query) {
            throw new Error("Query is required");
        }
    }

    private authenticateRequest(request: GatewayRequest): void {
        if (!request.headers || !request.headers.authorization) {
            throw new Error("Unauthorized");
        }
        const token = request.headers.authorization.split(" ")[1];
        try {
            // @ts-expect-error - env.SECRET_KEY is guaranteed to be a string by zod validation at startup
            const decoded = jwt.verify(token, env.SECRET_KEY) as unknown as { userId: string; permissions: string[] };
            request.userId = decoded.userId;
            request.permissions = decoded.permissions;
        } catch (err) {
            throw new Error("Unauthorized");
        }
    }

    private async executePlan(plan: ExecutionPlan, request: GatewayRequest): Promise<GatewayResponse> {
        const startTime = Date.now();
        let subgraphCalls = 0;
        const traceId = `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const aggregatedData: Record<string, any> = {};
        const errors: any[] = [];
        let cacheHit = false;

        for (const step of plan.steps) {
            try {
                const result = await this.executeStepWithRetries(step, request, traceId);
                subgraphCalls++;
                aggregatedData[step.field] = result;
            } catch (error) {
                errors.push({
                    message: `Failed to execute step for field '${step.field}'`,
                    error: (error as Error).message,
                });
            }
        }

        const endTime = Date.now();
        const duration = endTime - startTime;

        return {
            data: aggregatedData,
            errors: errors.length > 0 ? errors as any : undefined,
            extensions: {
                duration,
                subgraphCalls,
                cacheHit,
                traceId,
            },
        };
    }

    private async executeStepWithRetries(step: PlanStep, request: GatewayRequest, traceId: string): Promise<any> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.retryCount; attempt++) {
            try {
                return await this.executeStepWithTimeout(step, request, traceId);
            } catch (error) {
                lastError = error as Error;
                if (attempt < this.retryCount) {
                    const delay = Math.pow(2, attempt) * 100;
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }

        throw new Error(`Step failed after ${this.retryCount + 1} attempts: ${lastError?.message}`);
    }

    private executeStepWithTimeout(step: PlanStep, request: GatewayRequest, traceId: string): Promise<any> {
        return Promise.race([
            this.callSubgraph(step, request, traceId),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Request timeout after ${this.requestTimeout}ms`)), this.requestTimeout)
            ),
        ]);
    }

    private async callSubgraph(step: PlanStep, request: GatewayRequest, traceId: string): Promise<any> {
        const serviceBaseURL = this.getServiceBaseURL(step.service);
        
        if (!serviceBaseURL) {
            throw new Error(`No base URL configured for service: ${step.service}`);
        }

        const query = this.buildQuery(step.field, request);

        const response = await fetch(`${serviceBaseURL}/graphql`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${request.headers?.authorization?.split(" ")[1] || ""}`,
                "X-Trace-ID": traceId,
                "X-User-ID": request.userId || "",
            },
            body: JSON.stringify({
                query,
                variables: request.variables,
                operationName: request.operationName,
            }),
        });

        if (!response.ok) {
            throw new Error(`Subgraph request failed with status ${response.status}`);
        }

        const result = await response.json();

        if (result.errors) {
            throw new Error(`Subgraph returned errors: ${JSON.stringify(result.errors)}`);
        }

        return result.data;
    }

    private getServiceBaseURL(service: string): string | null {
        const serviceURLs: Record<string, string> = {
            users: process.env.USERS_SERVICE_URL || "http://localhost:4001",
            orders: process.env.ORDERS_SERVICE_URL || "http://localhost:4002",
            products: process.env.PRODUCTS_SERVICE_URL || "http://localhost:4003",
        };

        return serviceURLs[service] || null;
    }

    private buildQuery(field: string, request: GatewayRequest): string {
        return `
            query {
                ${field} {
                    __typename
                }
            }
        `;
    }
}
