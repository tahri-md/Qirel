import {
  Kind,
  parse,
  print,
  type DocumentNode,
  type FieldNode,
  type OperationDefinitionNode,
  type SelectionNode,
} from "graphql";
import { validateQuery } from "../parser/QueryParser.js";
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
    selections: readonly SelectionNode[],
    parentDepth: number = 0
  ): FieldMapping[] {
    const fields: FieldMapping[] = [];

    for (const selection of selections) {
      if (selection.kind !== Kind.FIELD) {
        continue;
      }

      const fieldName = selection.name.value;
      const subgraph = this.fieldToSubgraphMap.get(fieldName);
      const children = selection.selectionSet
        ? this.extractFieldsFromSelection(selection.selectionSet.selections, parentDepth + 1)
        : [];

      if (!subgraph) {
        fields.push(...children);
        continue;
      }

      const mapping: FieldMapping = {
        fieldName,
        subgraph,
        depth: parentDepth,
      };

      if (children.length > 0) {
        mapping.children = children;
      }

      fields.push(mapping);
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
    const depthCache = new Map<string, number>();
    const nodes: DependencyNode[] = [];

    for (const [subgraph, deps] of dependencies) {
      nodes.push({
        field: subgraph,
        subgraph,
        dependencies: deps,
        depth: this.calculateNodeDepth(subgraph, dependencies, depthCache, new Set()),
      });
    }

    return nodes;
  }

  private calculateNodeDepth(
    subgraph: string,
    dependencies: Map<string, Set<string>>,
    cache: Map<string, number>,
    visited: Set<string>
  ): number {
    if (cache.has(subgraph)) {
      return cache.get(subgraph)!;
    }

    if (visited.has(subgraph)) {
      return 0;
    }

    const deps = dependencies.get(subgraph);
    if (!deps || deps.size === 0) {
      cache.set(subgraph, 0);
      return 0;
    }

    visited.add(subgraph);
    let maxDepth = 0;

    for (const dependency of deps) {
      const dependencyDepth = this.calculateNodeDepth(
        dependency,
        dependencies,
        cache,
        new Set(visited)
      );
      maxDepth = Math.max(maxDepth, dependencyDepth);
    }

    visited.delete(subgraph);
    const depth = maxDepth + 1;
    cache.set(subgraph, depth);
    return depth;
  }

  private generateExecutionStages(
    nodes: DependencyNode[],
    subgraphQueries: Map<string, string>,
    subgraphFields: Map<string, string[]>,
    variables: Record<string, any> | undefined,
    fallbackQuery: string
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
          query: subgraphQueries.get(node.subgraph) ?? fallbackQuery,
          variables: variables ?? {},
          fields: subgraphFields.get(node.subgraph) ?? [],
          expectedResponseTime: this.getExpectedResponseTime(node.subgraph),
        })),
        dependencies: Array.from(
          new Set(
            readyNodes.flatMap((node) => Array.from(node.dependencies))
          )
        ),
        parallel: true,
        estimatedDuration:
          readyNodes.length > 0
            ? Math.max(...readyNodes.map((node) => this.getExpectedResponseTime(node.subgraph)))
            : 0,
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

  private buildSubgraphQueries(
    operation: OperationDefinitionNode,
    originalDocument: DocumentNode
  ): Map<string, string> {
    const groupedSelections = new Map<string, FieldNode[]>();

    for (const selection of operation.selectionSet.selections) {
      if (selection.kind !== Kind.FIELD) {
        continue;
      }

      const subgraph = this.fieldToSubgraphMap.get(selection.name.value);
      if (!subgraph) {
        continue;
      }

      const existing = groupedSelections.get(subgraph) ?? [];
      existing.push(selection);
      groupedSelections.set(subgraph, existing);
    }

    const queries = new Map<string, string>();

    for (const [subgraph, selections] of groupedSelections.entries()) {
      const subgraphOperationBase: OperationDefinitionNode = {
        ...operation,
        selectionSet: {
          ...operation.selectionSet,
          selections,
        },
      };

      const subgraphOperation: OperationDefinitionNode = operation.name
        ? {
            ...subgraphOperationBase,
            name: {
              ...operation.name,
              value: `${operation.name.value}_${subgraph}`,
            },
          }
        : subgraphOperationBase;

      const subgraphDocument: DocumentNode = {
        ...originalDocument,
        definitions: [subgraphOperation],
      };

      queries.set(subgraph, print(subgraphDocument));
    }

    return queries;
  }

  private collectSubgraphFields(fieldMappings: FieldMapping[]): Map<string, string[]> {
    const map = new Map<string, Set<string>>();

    const walk = (mappings: FieldMapping[]) => {
      for (const mapping of mappings) {
        const current = map.get(mapping.subgraph) ?? new Set<string>();
        current.add(mapping.fieldName);
        map.set(mapping.subgraph, current);

        if (mapping.children && mapping.children.length > 0) {
          walk(mapping.children);
        }
      }
    };

    walk(fieldMappings);

    const result = new Map<string, string[]>();
    for (const [subgraph, fields] of map.entries()) {
      result.set(subgraph, Array.from(fields));
    }

    return result;
  }

  public plan(query: string, variables?: Record<string, any>): ExecutionPlan {
    const validationResult = validateQuery(query, variables);
    if (!validationResult.valid) {
      throw new Error(`Invalid query: ${validationResult.errors.join(", ")}`);
    }

    const parsed = parse(query);
    const operation = parsed.definitions.find(
      (definition): definition is OperationDefinitionNode =>
        definition.kind === Kind.OPERATION_DEFINITION
    );

    if (!operation) {
      throw new Error("Query must contain at least one operation");
    }

    const fieldMappings = this.extractFieldsFromSelection(
      operation.selectionSet.selections
    );

    if (fieldMappings.length === 0) {
      throw new Error("Query does not target any registered subgraph fields");
    }

    const dependencies = this.identifyDependencies(fieldMappings);

    const nodes = this.buildDependencyNodes(dependencies);

    const subgraphQueries = this.buildSubgraphQueries(operation, parsed);
    const subgraphFields = this.collectSubgraphFields(fieldMappings);

    const stages = this.generateExecutionStages(
      nodes,
      subgraphQueries,
      subgraphFields,
      variables,
      query
    );

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