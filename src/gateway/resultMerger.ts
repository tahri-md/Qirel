import { GraphQLError } from "graphql";
import type { ExecutionContext } from "graphql/execution/execute.js";

export type SubgraphResponse = {
    subgraphName: string;
    data?: Record<string, unknown>;
    errors?: Array<string | GraphQLError | Error | { message?: string }>;
};

export type StitchedEntities = Record<string, Record<string, Record<string, unknown>>>;

export type MergedResult = {
    data: Record<string, unknown>;
    errors?: GraphQLError[];
    stitchedEntities: StitchedEntities;
};

export class ResultMerger {
    merge(results: SubgraphResponse[]): MergedResult {
        const mergedData: Record<string, unknown> = {};
        const collectedErrors: GraphQLError[] = [];

        for (const result of results) {
            if (result.data) {
                this.mergeDeep(mergedData, result.data);
            }

            if (result.errors) {
                for (const error of result.errors) {
                    collectedErrors.push(this.normalizeError(error, result.subgraphName));
                }
            }
        }

        const stitchedEntities = this.stitchEntities(results);
        const context = {
            contextValue: { stitchedEntities },
        } as unknown as ExecutionContext;

        const resolvedData = this.resolveExternalReferences(mergedData, context);

        return collectedErrors.length > 0
            ? {
                data: this.asRecord(resolvedData),
                errors: collectedErrors,
                stitchedEntities,
            }
            : {
                data: this.asRecord(resolvedData),
                stitchedEntities,
            };
    }

    stitchEntities(results: SubgraphResponse[]): StitchedEntities {
        const entities: StitchedEntities = {};

        for (const result of results) {
            if (!result.data) {
                continue;
            }

            this.collectEntities(result.data, entities);
        }

        return entities;
    }

    resolveExternalReferences(data: any, context: ExecutionContext): any {
        const stitchedEntities = this.getStitchedEntitiesFromContext(context);
        return this.resolveNode(data, stitchedEntities, new Set<string>());
    }

    private resolveNode(
        value: unknown,
        stitchedEntities: StitchedEntities,
        activeEntityKeys: Set<string>
    ): unknown {
        if (Array.isArray(value)) {
            return value.map((item) => this.resolveNode(item, stitchedEntities, activeEntityKeys));
        }

        if (!this.isRecord(value)) {
            return value;
        }

        if (typeof value.__ref === "string") {
            const byRef = this.getEntityByRef(value.__ref, stitchedEntities);
            if (byRef) {
                if (activeEntityKeys.has(value.__ref)) {
                    return byRef;
                }

                activeEntityKeys.add(value.__ref);
                const resolvedByRef = this.resolveNode(byRef, stitchedEntities, activeEntityKeys);
                activeEntityKeys.delete(value.__ref);
                return resolvedByRef;
            }
        }

        const typename = typeof value.__typename === "string" ? value.__typename : null;
        const entityId = this.readEntityId(value);

        if (typename && entityId) {
            const stitched = stitchedEntities[typename]?.[entityId];
            if (stitched) {
                const entityKey = `${typename}:${entityId}`;
                if (activeEntityKeys.has(entityKey)) {
                    return value;
                }

                activeEntityKeys.add(entityKey);
                const merged = { ...stitched, ...value };
                const resolved = this.resolveNode(merged, stitchedEntities, activeEntityKeys);
                activeEntityKeys.delete(entityKey);
                return resolved;
            }
        }

        const resolved: Record<string, unknown> = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            resolved[key] = this.resolveNode(nestedValue, stitchedEntities, activeEntityKeys);
        }

        return resolved;
    }

    private collectEntities(value: unknown, entities: StitchedEntities): void {
        if (Array.isArray(value)) {
            for (const item of value) {
                this.collectEntities(item, entities);
            }
            return;
        }

        if (!this.isRecord(value)) {
            return;
        }

        const typename = typeof value.__typename === "string" ? value.__typename : null;
        const entityId = this.readEntityId(value);

        if (typename && entityId) {
            if (!entities[typename]) {
                entities[typename] = {};
            }

            const existing = entities[typename][entityId];
            entities[typename][entityId] = existing
                ? this.mergeDeep({ ...existing }, value)
                : { ...value };
        }

        for (const nestedValue of Object.values(value)) {
            this.collectEntities(nestedValue, entities);
        }
    }

    private getEntityByRef(ref: string, entities: StitchedEntities): Record<string, unknown> | null {
        const [typename, entityId] = ref.split(":");
        if (!typename || !entityId) {
            return null;
        }

        return entities[typename]?.[entityId] ?? null;
    }

    private readEntityId(value: Record<string, unknown>): string | null {
        const candidate = value.id ?? value._id ?? value.key;
        if (candidate === undefined || candidate === null) {
            return null;
        }

        return String(candidate);
    }

    private getStitchedEntitiesFromContext(context: ExecutionContext): StitchedEntities {
        const contextValue = (context as { contextValue?: unknown }).contextValue;
        if (!this.isRecord(contextValue)) {
            return {};
        }

        const stitched = contextValue.stitchedEntities;
        if (!this.isRecord(stitched)) {
            return {};
        }

        return stitched as StitchedEntities;
    }

    private normalizeError(
        error: string | GraphQLError | Error | { message?: string },
        subgraphName: string
    ): GraphQLError {
        if (error instanceof GraphQLError) {
            return new GraphQLError(`[${subgraphName}] ${error.message}`);
        }

        if (error instanceof Error) {
            return new GraphQLError(`[${subgraphName}] ${error.message}`);
        }

        if (typeof error === "string") {
            return new GraphQLError(`[${subgraphName}] ${error}`);
        }

        return new GraphQLError(`[${subgraphName}] ${error.message ?? "Unknown subgraph error"}`);
    }

    private mergeDeep(
        target: Record<string, unknown>,
        source: Record<string, unknown>
    ): Record<string, unknown> {
        for (const [key, sourceValue] of Object.entries(source)) {
            const targetValue = target[key];

            if (Array.isArray(sourceValue)) {
                if (Array.isArray(targetValue)) {
                    target[key] = this.mergeArrays(targetValue, sourceValue);
                } else {
                    target[key] = [...sourceValue];
                }
                continue;
            }

            if (this.isRecord(sourceValue) && this.isRecord(targetValue)) {
                target[key] = this.mergeDeep({ ...targetValue }, sourceValue);
                continue;
            }

            target[key] = sourceValue;
        }

        return target;
    }

    private mergeArrays(target: unknown[], source: unknown[]): unknown[] {
        const combined = [...target, ...source];
        const seen = new Set<string>();
        const deduped: unknown[] = [];

        for (const item of combined) {
            const key = this.arrayItemKey(item);
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(item);
            }
        }

        return deduped;
    }

    private arrayItemKey(value: unknown): string {
        if (this.isRecord(value)) {
            const typename = typeof value.__typename === "string" ? value.__typename : "";
            const entityId = this.readEntityId(value) ?? "";
            if (typename && entityId) {
                return `${typename}:${entityId}`;
            }
            return JSON.stringify(value);
        }

        return String(value);
    }

    private asRecord(value: unknown): Record<string, unknown> {
        if (this.isRecord(value)) {
            return value;
        }
        return {};
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
}
