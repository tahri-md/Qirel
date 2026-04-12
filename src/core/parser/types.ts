export type GraphQLDocument = {
  kind: "Document";
  definitions: OperationDefinition[];
};

export type OperationDefinition = {
  kind: "OperationDefinition";
  operation: "query" | "mutation" | "subscription";
  name?: Name;
  variableDefinitions?: VariableDefinition[];
  selectionSet: SelectionSet;
};

export type Name = {
  value: string;
};

export type VariableDefinition = {
  variable: {
    name: Name;
  };
  type: string;
};

export type SelectionSet = {
  selections: Selection[];
};

export type Selection = Field;

export type Field = {
  kind: "Field";
  name: Name;
  arguments?: Argument[];
  selectionSet?: SelectionSet;
};

export type Argument = {
  name: Name;
  value: Variable | LiteralValue;
};

export type Variable = {
  kind: "Variable";
  name: Name;
};

export type LiteralValue = {
  kind: "StringValue" | "IntValue" | "BooleanValue";
  value: string | number | boolean;
};
