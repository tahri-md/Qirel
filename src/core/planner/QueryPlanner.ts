import { parse } from "graphql";
import type { DocumentNode, OperationDefinitionNode, FieldNode } from "graphql";

export type PlanStep = {
  service: string;
  field: string;
};

export type ExecutionPlan = {
  steps: PlanStep[];
};

const fieldToServiceMap: Record<string, string> = {
  user: "users",
  orders: "orders",
  product: "products",
};

export class QueryPlanner {
  plan(query: string): ExecutionPlan {
    const ast: DocumentNode = parse(query);

    const steps: PlanStep[] = [];

    for (const definition of ast.definitions) {

      if (definition.kind !== "OperationDefinition") continue;

      const operation = definition as OperationDefinitionNode;

      for (const selection of operation.selectionSet.selections) {

        if (selection.kind !== "Field") continue;

        const field = selection as FieldNode;
        const fieldName = field.name.value;

        const service = fieldToServiceMap[fieldName];

        if (!service) {
          throw new Error(`No service found for field: ${fieldName}`);
        }

        steps.push({
          service,
          field: fieldName,
        });
      }
    }

    return { steps };
  }
}