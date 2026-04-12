import type { ExecutionContext, ExecutionResult } from "graphql/execution/execute.js";
import { GraphQLError } from "graphql";
import DataLoader from "dataloader";
import type { ExecutionPlan, ExecutionStage, SubgraphOperation } from "../planner/types.js";
import { env } from "../../configs/env.js";

type SubgraphResponse = {
  subgraphName: string;
  duration: number;
  data: Record<string, unknown>;
  errors?: string[];
};

type StageResult = SubgraphResponse;

type ContextValue = {
    query?: string;
    variables?: Record<string, unknown>;
    operationName?: string;
    userId?: string;
    headers?: Record<string, string>;
    requestTimeoutMs?: number;
    retryCount?: number;
    traceId?: string;
    useDataLoader?: boolean;
};

type PendingLoad = {
    operation: SubgraphOperation;
    contextValue: ContextValue;
};

type ExecutionRuntime = {
    contextValue: ContextValue;
    loaders: Map<string, DataLoader<string, Record<string, unknown>>>;
    pendingLoads: Map<string, PendingLoad>;
};

export class DistributedExecutor {
    private readonly defaultTimeoutMs = Number(env.REQUEST_TIMEOUT_MS) || 5000;
    private readonly defaultRetryCount = Number(env.RETRY_COUNT) || 0;

    async execute(plan: ExecutionPlan, context: ExecutionContext): Promise<ExecutionResult> {
        const runtime = this.buildRuntime(context);
        const data: Record<string, unknown> = {};
        const errors: GraphQLError[] = [];

        for (const stage of plan.stages) {
            const stageResults = await this.executeStageInternal(stage, runtime);
            data[stage.stageId] = stageResults;

            for (const result of stageResults) {
                if (!result.errors) {
                    continue;
                }

                for (const message of result.errors) {
                    errors.push(new GraphQLError(`[${stage.stageId}/${result.subgraphName}] ${message}`));
                }
            }
        }

        return errors.length > 0 ? { data, errors } : { data };
    }

    async executeStage(stage: ExecutionStage, context: ExecutionContext): Promise<StageResult[]> {
        return this.executeStageInternal(stage, this.buildRuntime(context));
    }

    async executeSubgraphOperation(
        operation: SubgraphOperation,
        context: ExecutionContext
    ): Promise<SubgraphResponse> {
        return this.executeSubgraphOperationInternal(operation, this.buildRuntime(context));
    }

    private async executeStageInternal(
        stage: ExecutionStage,
        runtime: ExecutionRuntime
    ): Promise<StageResult[]> {
        if (stage.parallel) {
            return Promise.all(
                stage.operations.map((operation) => this.executeSubgraphOperationInternal(operation, runtime))
            );
        }

        const results: StageResult[] = [];
        for (const operation of stage.operations) {
            results.push(await this.executeSubgraphOperationInternal(operation, runtime));
        }

        return results;
    }

    private async executeSubgraphOperationInternal(
        operation: SubgraphOperation,
        runtime: ExecutionRuntime
    ): Promise<SubgraphResponse> {
        const startedAt = Date.now();

        try {
            const data = await this.loadOperation(operation, runtime);
            return {
                subgraphName: operation.subgraphName,
                duration: Date.now() - startedAt,
                data,
            };
        } catch (error) {
            return {
                subgraphName: operation.subgraphName,
                duration: Date.now() - startedAt,
                data: {},
                errors: [this.readError(error)],
            };
        }
    }

    private loadOperation(
        operation: SubgraphOperation,
        runtime: ExecutionRuntime
    ): Promise<Record<string, unknown>> {
        if (runtime.contextValue.useDataLoader === false) {
            return this.executeWithRetry(operation, runtime.contextValue);
        }

        const loader = this.getLoader(operation.subgraphName, runtime);
        const operationKey = this.makeOperationKey(operation, runtime.contextValue);
        const lookupKey = `${operation.subgraphName}:${operationKey}`;

        runtime.pendingLoads.set(lookupKey, {
            operation,
            contextValue: runtime.contextValue,
        });

        return loader.load(operationKey);
    }

    private getLoader(
        subgraphName: string,
        runtime: ExecutionRuntime
    ): DataLoader<string, Record<string, unknown>> {
        const existing = runtime.loaders.get(subgraphName);
        if (existing) {
            return existing;
        }

        const loader = new DataLoader<string, Record<string, unknown>>(async (keys) => {
            const results: Array<Record<string, unknown> | Error> = [];

            for (const key of keys) {
                const lookupKey = `${subgraphName}:${key}`;
                const pending = runtime.pendingLoads.get(lookupKey);
                runtime.pendingLoads.delete(lookupKey);

                if (!pending) {
                    results.push(new Error(`Missing pending operation for ${subgraphName}`));
                    continue;
                }

                try {
                    const response = await this.executeWithRetry(pending.operation, pending.contextValue);
                    results.push(response);
                } catch (error) {
                    results.push(new Error(this.readError(error)));
                }
            }

            return results;
        });

        runtime.loaders.set(subgraphName, loader);
        return loader;
    }

    private makeOperationKey(operation: SubgraphOperation, contextValue: ContextValue): string {
        const query = operation.query || contextValue.query || "";
        const variables = Object.keys(operation.variables).length
            ? operation.variables
            : (contextValue.variables ?? {});

        return JSON.stringify({
            operationName: contextValue.operationName ?? "",
            query,
            variables,
        });
    }

    private async executeWithRetry(
        operation: SubgraphOperation,
        contextValue: ContextValue
    ): Promise<Record<string, unknown>> {
        const retryCount = contextValue.retryCount ?? this.defaultRetryCount;
        let lastError: unknown;

        for (let attempt = 0; attempt <= retryCount; attempt++) {
            try {
                return await this.executeWithTimeout(operation, contextValue);
            } catch (error) {
                lastError = error;
                if (attempt < retryCount) {
                    await this.wait(Math.pow(2, attempt) * 100);
                }
            }
        }

        throw new Error(this.readError(lastError));
    }

    private executeWithTimeout(
        operation: SubgraphOperation,
        contextValue: ContextValue
    ): Promise<Record<string, unknown>> {
        const timeoutMs = contextValue.requestTimeoutMs ?? this.defaultTimeoutMs;

        return Promise.race([
            this.callSubgraph(operation, contextValue),
            new Promise<Record<string, unknown>>((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Request timeout after ${timeoutMs}ms for ${operation.subgraphName}`));
                }, timeoutMs);
            }),
        ]);
    }

    private async callSubgraph(
        operation: SubgraphOperation,
        contextValue: ContextValue
    ): Promise<Record<string, unknown>> {
        const serviceURL = this.getServiceURL(operation.subgraphName);
        if (!serviceURL) {
            throw new Error(`No base URL configured for service '${operation.subgraphName}'`);
        }

        const query = operation.query || contextValue.query;
        if (!query) {
            throw new Error(`Missing query for service '${operation.subgraphName}'`);
        }

        const variables = Object.keys(operation.variables).length
            ? operation.variables
            : contextValue.variables;

        const response = await fetch(`${serviceURL}/graphql`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(contextValue.headers ?? {}),
                ...(contextValue.userId ? { "X-User-ID": contextValue.userId } : {}),
                ...(contextValue.traceId ? { "X-Trace-ID": contextValue.traceId } : {}),
            },
            body: JSON.stringify({
                query,
                variables,
                operationName: contextValue.operationName,
            }),
        });

        if (!response.ok) {
            throw new Error(`Subgraph '${operation.subgraphName}' failed with status ${response.status}`);
        }

        const payload = (await response.json()) as { data?: unknown; errors?: unknown };

        if (payload.errors) {
            throw new Error(`Subgraph '${operation.subgraphName}' returned errors`);
        }

        return this.toObject(payload.data);
    }

    private getServiceURL(service: string): string | null {
        const urls: Record<string, string> = {
            users: env.USERS_SERVICE_URL,
            orders: env.ORDERS_SERVICE_URL,
            products: env.PRODUCTS_SERVICE_URL,
        };

        return urls[service] ?? null;
    }

    private toObject(value: unknown): Record<string, unknown> {
        if (value && typeof value === "object") {
            return value as Record<string, unknown>;
        }

        return {};
    }

    private readError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        return String(error);
    }

    private wait(ms: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, Math.max(ms, 0));
        });
    }

    private getContextValue(context: ExecutionContext): ContextValue {
        const contextValue = (context as { contextValue?: unknown }).contextValue;

        if (contextValue && typeof contextValue === "object") {
            return contextValue as ContextValue;
        }

        return {};
    }

    private buildRuntime(context: ExecutionContext): ExecutionRuntime {
        return {
            contextValue: this.getContextValue(context),
            loaders: new Map<string, DataLoader<string, Record<string, unknown>>>(),
            pendingLoads: new Map<string, PendingLoad>(),
        };
    }
}

const executor = new DistributedExecutor();

export async function execute(
  plan: ExecutionPlan,
  context: ExecutionContext
): Promise<ExecutionResult> {
  return executor.execute(plan, context);
}
