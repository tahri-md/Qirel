import jwt from "jsonwebtoken";
import { GraphQLError } from "graphql";
import type { ExecutionContext, ExecutionResult } from "graphql/execution/execute.js";
import type { GatewayRequest, GatewayResponse } from "./types.js";
import { QueryPlanner, type ExecutionPlan } from "../planner/QueryPlanner.js";
import { DistributedExecutor } from "../executor/QueryExecutor.js";
import { ResultMerger, type SubgraphResponse } from "../../gateway/resultMerger.js";
import { env } from "../../configs/env.js";

type AuthTokenPayload = {
    userId: string;
    permissions: string[];
};

type ExecutorSubgraphResponse = {
    subgraphName: string;
    data: Record<string, unknown>;
    errors?: string[];
};

export class RequestHandler {
    private readonly requestTimeout: number;
    private readonly retryCount: number;
    private readonly planner: QueryPlanner;
    private readonly executor: DistributedExecutor;
    private readonly merger: ResultMerger;

    constructor(
        requestTimeout: number,
        retryCount: number,
        planner: QueryPlanner,
        executor = new DistributedExecutor(),
        merger = new ResultMerger()
    ) {
        this.requestTimeout = requestTimeout;
        this.retryCount = retryCount;
        this.planner = planner;
        this.executor = executor;
        this.merger = merger;
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
        const authorization = this.readHeader(request.headers, "authorization");
        if (!authorization) {
            throw new Error("Unauthorized");
        }

        const token = this.readBearerToken(authorization);
        if (!token) {
            throw new Error("Unauthorized");
        }

        try {
            const decoded = jwt.verify(token, env.SECRET_KEY) as unknown as AuthTokenPayload;
            request.userId = decoded.userId;
            request.permissions = decoded.permissions;
        } catch {
            throw new Error("Unauthorized");
        }
    }

    private async executePlan(plan: ExecutionPlan, request: GatewayRequest): Promise<GatewayResponse> {
        const startTime = Date.now();
        const traceId = this.readHeader(request.headers, "x-trace-id")
            || `trace-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

        const context = this.buildExecutionContext(request, traceId);
        const executionResult = await this.executor.execute(plan, context);
        const subgraphResponses = this.collectSubgraphResponses(executionResult);
        const merged = this.merger.merge(subgraphResponses);

        const errors: GraphQLError[] = [
            ...(executionResult.errors ?? []),
            ...(merged.errors ?? []),
        ];

        const duration = Date.now() - startTime;

        const response: GatewayResponse = {
            data: merged.data,
            extensions: {
                duration,
                subgraphCalls: subgraphResponses.length,
                cacheHit: false,
                traceId,
            },
        };

        if (errors.length > 0) {
            response.errors = errors;
        }

        return response;
    }

    private buildExecutionContext(request: GatewayRequest, traceId: string): ExecutionContext {
        return {
            contextValue: {
                query: request.query,
                variables: request.variables,
                operationName: request.operationName,
                userId: request.userId,
                headers: this.forwardHeaders(request.headers, traceId),
                requestTimeoutMs: this.requestTimeout,
                retryCount: this.retryCount,
                traceId,
                useDataLoader: true,
            },
        } as unknown as ExecutionContext;
    }

    private collectSubgraphResponses(result: ExecutionResult): SubgraphResponse[] {
        const responses: SubgraphResponse[] = [];
        const data = result.data;

        if (!this.isRecord(data)) {
            return responses;
        }

        for (const stageValue of Object.values(data)) {
            if (!Array.isArray(stageValue)) {
                continue;
            }

            for (const stageItem of stageValue) {
                if (!this.isExecutorSubgraphResponse(stageItem)) {
                    continue;
                }

                const response: SubgraphResponse = {
                    subgraphName: stageItem.subgraphName,
                    data: stageItem.data,
                };

                if (stageItem.errors && stageItem.errors.length > 0) {
                    response.errors = stageItem.errors;
                }

                responses.push(response);
            }
        }

        return responses;
    }

    private isExecutorSubgraphResponse(value: unknown): value is ExecutorSubgraphResponse {
        if (!this.isRecord(value)) {
            return false;
        }

        return typeof value.subgraphName === "string" && this.isRecord(value.data);
    }

    private forwardHeaders(
        headers: Record<string, string> | undefined,
        traceId: string
    ): Record<string, string> {
        const allowedHeaders = new Set([
            "authorization",
            "x-trace-id",
            "x-request-id",
            "x-correlation-id",
        ]);

        const forwarded: Record<string, string> = {
            "x-trace-id": traceId,
        };

        if (!headers) {
            return forwarded;
        }

        for (const [key, value] of Object.entries(headers)) {
            if (!value) {
                continue;
            }

            const normalizedKey = key.toLowerCase();
            if (!allowedHeaders.has(normalizedKey) && !normalizedKey.startsWith("x-")) {
                continue;
            }

            forwarded[normalizedKey] = value;
        }

        return forwarded;
    }

    private readHeader(
        headers: Record<string, string> | undefined,
        headerName: string
    ): string | null {
        if (!headers) {
            return null;
        }

        const target = headerName.toLowerCase();
        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === target && value) {
                return value;
            }
        }

        return null;
    }

    private readBearerToken(authorization: string): string | null {
        const trimmed = authorization.trim();
        if (!trimmed) {
            return null;
        }

        if (trimmed.toLowerCase().startsWith("bearer ")) {
            return trimmed.slice(7).trim() || null;
        }

        return trimmed;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
}
