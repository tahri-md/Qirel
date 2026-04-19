type GatewayRequestMetric = {
    durationMs: number;
    subgraphCalls: number;
    cacheHit: boolean;
    hasError: boolean;
};

type SubgraphHealthMetric = {
    up: boolean;
    latencyMs: number;
    checkedAt: number;
};

class GatewayMetrics {
    private totalRequests = 0;
    private totalErrors = 0;
    private totalDurationMs = 0;
    private totalSubgraphCalls = 0;
    private totalCacheHits = 0;
    private readonly subgraphHealth = new Map<string, SubgraphHealthMetric>();

    recordGatewayRequest(metric: GatewayRequestMetric): void {
        this.totalRequests += 1;
        this.totalDurationMs += Math.max(0, metric.durationMs);
        this.totalSubgraphCalls += Math.max(0, metric.subgraphCalls);

        if (metric.cacheHit) {
            this.totalCacheHits += 1;
        }

        if (metric.hasError) {
            this.totalErrors += 1;
        }
    }

    recordSubgraphHealth(subgraph: string, up: boolean, latencyMs: number): void {
        this.subgraphHealth.set(subgraph, {
            up,
            latencyMs: Math.max(0, latencyMs),
            checkedAt: Date.now(),
        });
    }

    getSnapshot() {
        const averageDurationMs = this.totalRequests > 0
            ? this.totalDurationMs / this.totalRequests
            : 0;

        const cacheHitRate = this.totalRequests > 0
            ? this.totalCacheHits / this.totalRequests
            : 0;

        const errorRate = this.totalRequests > 0
            ? this.totalErrors / this.totalRequests
            : 0;

        return {
            totalRequests: this.totalRequests,
            totalErrors: this.totalErrors,
            averageDurationMs,
            totalSubgraphCalls: this.totalSubgraphCalls,
            cacheHitRate,
            errorRate,
            subgraphHealth: Array.from(this.subgraphHealth.entries()).map(([name, status]) => ({
                name,
                ...status,
            })),
        };
    }

    renderPrometheusMetrics(): string {
        const snapshot = this.getSnapshot();
        const lines: string[] = [
            "# HELP graphql_gateway_requests_total Total number of gateway requests",
            "# TYPE graphql_gateway_requests_total counter",
            `graphql_gateway_requests_total ${snapshot.totalRequests}`,
            "# HELP graphql_gateway_errors_total Total number of gateway requests that returned errors",
            "# TYPE graphql_gateway_errors_total counter",
            `graphql_gateway_errors_total ${snapshot.totalErrors}`,
            "# HELP graphql_gateway_request_duration_avg_ms Average gateway request duration in milliseconds",
            "# TYPE graphql_gateway_request_duration_avg_ms gauge",
            `graphql_gateway_request_duration_avg_ms ${snapshot.averageDurationMs.toFixed(2)}`,
            "# HELP graphql_gateway_subgraph_calls_total Total number of subgraph calls issued",
            "# TYPE graphql_gateway_subgraph_calls_total counter",
            `graphql_gateway_subgraph_calls_total ${snapshot.totalSubgraphCalls}`,
            "# HELP graphql_gateway_cache_hit_rate Cache hit ratio for gateway requests",
            "# TYPE graphql_gateway_cache_hit_rate gauge",
            `graphql_gateway_cache_hit_rate ${snapshot.cacheHitRate.toFixed(4)}`,
            "# HELP graphql_gateway_error_rate Request error ratio",
            "# TYPE graphql_gateway_error_rate gauge",
            `graphql_gateway_error_rate ${snapshot.errorRate.toFixed(4)}`,
        ];

        for (const subgraph of snapshot.subgraphHealth) {
            lines.push(`# HELP graphql_subgraph_up_${subgraph.name} Subgraph availability (1=up,0=down)`);
            lines.push(`# TYPE graphql_subgraph_up_${subgraph.name} gauge`);
            lines.push(`graphql_subgraph_up{subgraph=\"${subgraph.name}\"} ${subgraph.up ? 1 : 0}`);
            lines.push(`# HELP graphql_subgraph_latency_ms_${subgraph.name} Last observed subgraph latency`);
            lines.push(`# TYPE graphql_subgraph_latency_ms_${subgraph.name} gauge`);
            lines.push(`graphql_subgraph_latency_ms{subgraph=\"${subgraph.name}\"} ${subgraph.latencyMs}`);
        }

        return `${lines.join("\n")}\n`;
    }
}

export const gatewayMetrics = new GatewayMetrics();
