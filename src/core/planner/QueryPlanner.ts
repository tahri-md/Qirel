import type { GraphQLDocument, OperationDefinition, SelectionSet, Field } from "../parser/types.js";
import { parseQuery, validateQuery } from "../parser/QueryParser.js";
import type { ExecutionPlan, ExecutionStage, SubgraphOperation, FieldMapping, SubgraphSchema, DependencyNode } from "./types.js";

export class QueryPlanner {
  private subgraphSchema: SubgraphSchema;
  private fieldToSubgraphMap: Map<string, string> = new Map();

  constructor(schema: SubgraphSchema) {
    this.subgraphSchema = schema;
    this.buildFieldMap();
  }

  private buildFieldMap(): void {
    for (const [subgraphName, schema] of Object.entries(this.subgraphSchema)) {
      for (const fieldName of Object.keys(schema.fields)) {
        this.fieldToSubgraphMap.set(fieldName, subgraphName);
      }
    }
  }

  private extractFieldsFromSelection(
    selections: any[],
    parentDepth: number = 0
  ): FieldMapping[] {
    const fields: FieldMapping[] = [];

    for (const selection of selections) {
      if (selection.kind === "Field") {
        const fieldName = selection.name.value;
        const subgraph = this.fieldToSubgraphMap.get(fieldName);

        if (subgraph) {
          const mapping: FieldMapping = {
            fieldName,
            subgraph,
            depth: parentDepth,
          };

          if (selection.selectionSet) {
            mapping.children = this.extractFieldsFromSelection(
              selection.selectionSet.selections,
              parentDepth + 1
            );
          }

          fields.push(mapping);
        }
      }
    }

    return fields;
  }

  private identifyDependencies(
    fieldMappings: FieldMapping[]
  ): Map<string, Set<string>> {
    const dependencies = new Map<string, Set<string>>();

    const uniqueSubgraphs = new Set<string>();
    this.collectSubgraphs(fieldMappings, uniqueSubgraphs);
    uniqueSubgraphs.forEach((sg) => dependencies.set(sg, new Set()));

    this.buildDependencyGraph(fieldMappings, null, dependencies);

    return dependencies;
  }

  private collectSubgraphs(
    fieldMappings: FieldMapping[],
    subgraphs: Set<string>
  ): void {
    for (const mapping of fieldMappings) {
      subgraphs.add(mapping.subgraph);
      if (mapping.children) {
        this.collectSubgraphs(mapping.children, subgraphs);
      }
    }
  }

  private buildDependencyGraph(
    fieldMappings: FieldMapping[],
    parentSubgraph: string | null,
    dependencies: Map<string, Set<string>>
  ): void {
    for (const mapping of fieldMappings) {
      if (parentSubgraph && parentSubgraph !== mapping.subgraph) {
        dependencies.get(mapping.subgraph)?.add(parentSubgraph);
      }

      if (mapping.children) {
        this.buildDependencyGraph(mapping.children, mapping.subgraph, dependencies);
      }
    }
  }

  private buildDependencyNodes(
    dependencies: Map<string, Set<string>>
  ): DependencyNode[] {
    const nodes: DependencyNode[] = [];

    for (const [subgraph, deps] of dependencies) {
      nodes.push({
        field: subgraph,
        subgraph,
        dependencies: deps,
        depth: 0,
      });
    }

    for (const node of nodes) {
      node.depth = this.calculateNodeDepth(node, new Set());
    }

    return nodes;
  }

  private calculateNodeDepth(
    node: DependencyNode,
    visited: Set<string>
  ): number {
    if (visited.has(node.subgraph)) {
      return 0;
    }

    if (node.dependencies.size === 0) {
      return 0;
    }

    visited.add(node.subgraph);
    let maxDepth = 0;

    for (const depGraph of node.dependencies) {
      const depNode = { field: depGraph, subgraph: depGraph, dependencies: new Set<string>(), depth: 0 };
      const foundDep = Array.from(node.dependencies).map(dep => ({
        field: dep,
        subgraph: dep,
        dependencies: new Set<string>(),
        depth: 0
      }));
      const actualDepNode = foundDep.find(n => n.subgraph === depGraph);
      if (actualDepNode) {
        const depDepth = this.calculateNodeDepth(actualDepNode, new Set(visited));
        maxDepth = Math.max(maxDepth, depDepth);
      }
    }

    visited.delete(node.subgraph);
    return maxDepth + 1;
  }

  private generateExecutionStages(
    nodes: DependencyNode[]
  ): ExecutionStage[] {
    const stages: ExecutionStage[] = [];
    const processed = new Set<string>();
    let stageNumber = 0;

    while (processed.size < nodes.length) {
      const readyNodes = nodes.filter(
        (node) =>
          !processed.has(node.subgraph) &&
          Array.from(node.dependencies).every((dep) => processed.has(dep))
      );

      if (readyNodes.length === 0) {
        break;
      }

      const stage: ExecutionStage = {
        stageId: `stage-${stageNumber}`,
        operations: readyNodes.map((node) => ({
          subgraphName: node.subgraph,
          query: "",
          variables: {},
          fields: [],
          expectedResponseTime: this.getExpectedResponseTime(node.subgraph),
        })),
        dependencies: Array.from(
          new Set(
            readyNodes.flatMap((node) => Array.from(node.dependencies))
          )
        ),
        parallel: true,
        estimatedDuration: Math.max(
          ...readyNodes.map((node) =>
            this.getExpectedResponseTime(node.subgraph)
          )
        ),
      };

      stages.push(stage);
      readyNodes.forEach((node) => processed.add(node.subgraph));
      stageNumber++;
    }

    return stages;
  }

  private estimateTotalExecutionTime(stages: ExecutionStage[]): number {
    return stages.reduce((total, stage) => total + stage.estimatedDuration, 0);
  }

  private getExpectedResponseTime(subgraphName: string): number {
    const schema = this.subgraphSchema[subgraphName];
    if (!schema) return 100;

    let max = 100;
    for (const fieldConfig of Object.values(schema.fields)) {
      if (fieldConfig.expectedResponseTime) {
        max = Math.max(max, fieldConfig.expectedResponseTime);
      }
    }
    return max;
  }

  public plan(query: string, variables?: Record<string, any>): ExecutionPlan {
    const validationResult = validateQuery(query, variables);
    if (!validationResult.valid) {
      throw new Error(`Invalid query: ${validationResult.errors.join(", ")}`);
    }

    const parsed = parseQuery(query);
    const operation = parsed.definitions[0] as OperationDefinition;

    const fieldMappings = this.extractFieldsFromSelection(
      operation.selectionSet.selections
    );

    const dependencies = this.identifyDependencies(fieldMappings);

    const nodes = this.buildDependencyNodes(dependencies);

    const stages = this.generateExecutionStages(nodes);

    const estimatedDuration = this.estimateTotalExecutionTime(stages);

    const parallelizable = stages.some((stage) => stage.operations.length > 1);

    return {
      stages,
      estimatedDuration,
      parallelizable,
      dependencies,
    };
  }
}

export type { ExecutionPlan, ExecutionStage, SubgraphOperation, SubgraphSchema, FieldMapping };