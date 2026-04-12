export type ExecutionPlan = {
  stages: ExecutionStage[];
  estimatedDuration: number;
  parallelizable: boolean;
  dependencies: Map<string, Set<string>>;
};

export type ExecutionStage = {
  stageId: string;
  operations: SubgraphOperation[];
  dependencies: string[];
  parallel: boolean;
  estimatedDuration: number;
};

export type SubgraphOperation = {
  subgraphName: string;
  query: string;
  variables: Record<string, any>;
  fields: string[];
  expectedResponseTime: number;
};

export type FieldMapping = {
  fieldName: string;
  subgraph: string;
  depth: number;
  children?: FieldMapping[];
};

export type SubgraphSchema = {
  [subgraphName: string]: {
    fields: Record<string, { type: string; expectedResponseTime?: number }>;
    dependencies?: string[];
  };
};

export type DependencyNode = {
  field: string;
  subgraph: string;
  dependencies: Set<string>;
  depth: number;
};
