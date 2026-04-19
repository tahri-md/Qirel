import { parse } from "graphql";
import type { 
    GraphQLDocument, 
    OperationDefinition, 
    VariableDefinition,
    Name,
    SelectionSet,
    Field,
    Selection
} from "./types.js";

export function parseQuery(query: string): GraphQLDocument {
    const parsed = parse(query);
    const document: GraphQLDocument = {
        kind: "Document" as const,
        definitions: parseDefinitions(parsed.definitions),
    };
    return document;
}

export interface GraphQLSchema {
    types: Map<string, GraphQLType>;
}

export interface GraphQLType {
    name: string;
    kind: "OBJECT" | "SCALAR" | "ENUM" | "INPUT" | "INTERFACE" | "UNION";
    fields?: Map<string, GraphQLField>;
}

export interface GraphQLField {
    name: string;
    type: string;
    args?: Array<{ name: string; type: string }>;
}

export interface QueryComplexity {
    depth: number;
    complexity: number;
    maxDepth: number;
    maxComplexity: number;
}

export interface FieldComplexity {
    field: string;
    complexity: number;
    depth: number;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    complexity?: QueryComplexity;
    recursionDetected?: boolean;
}

export function validateQuery(query: string, variables?: Record<string, any>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!query || query.trim() === "") {
        errors.push("Query cannot be empty");
        return { valid: false, errors, warnings };
    }

    let parsed;
    try {
        parsed = parse(query);
    } catch (error: any) {
        errors.push(`GraphQL syntax error: ${error.message}`);
        return { valid: false, errors, warnings };
    }

    const operationDefs = parsed.definitions.filter((def: any) => def.kind === "OperationDefinition");
    if (operationDefs.length === 0) {
        errors.push("Query must contain at least one operation");
        return { valid: false, errors, warnings };
    }

    for (const opDef of operationDefs) {
        validateOperationDefinition(opDef, errors, warnings);
    }

    if (variables) {
        for (const opDef of operationDefs) {
            validateProvidedVariables(opDef, variables, errors);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

function validateOperationDefinition(
    opDef: any,
    errors: string[],
    warnings: string[]
): void {
    const validOperations = ["query", "mutation", "subscription"];
    if (!validOperations.includes(opDef.operation)) {
        errors.push(`Invalid operation type: ${opDef.operation}. Must be query, mutation, or subscription.`);
    }

    if (!opDef.selectionSet || !opDef.selectionSet.selections || opDef.selectionSet.selections.length === 0) {
        errors.push(
            `Operation ${opDef.name?.value || "anonymous"} must have at least one field in the selection set`
        );
    }

    if (opDef.variableDefinitions && opDef.variableDefinitions.length > 0) {
        for (const varDef of opDef.variableDefinitions) {
            validateVariableDefinition(varDef, errors);
        }
    }
}

function validateVariableDefinition(varDef: any, errors: string[]): void {
    if (!varDef.variable || !varDef.variable.name) {
        errors.push("Variable definition must have a name");
        return;
    }

    if (!varDef.type) {
        errors.push(`Variable $${varDef.variable.name.value} must have a type`);
    }
}

function validateProvidedVariables(
    opDef: any,
    variables: Record<string, any>,
    errors: string[]
): void {
    if (!opDef.variableDefinitions || opDef.variableDefinitions.length === 0) {
        return;
    }

    for (const varDef of opDef.variableDefinitions) {
        const varName = varDef.variable.name.value;
        const isRequired = varDef.type.kind === "NonNullType" || 
                          (varDef.type.type && varDef.type.type.kind === "NonNullType");

        if (isRequired && !(varName in variables)) {
            errors.push(`Required variable $${varName} is not provided`);
        }
    }
}

function parseDefinitions(definitions: readonly any[]): OperationDefinition[] {
    return definitions
        .filter(def => def.kind === "OperationDefinition")
        .map(definition => {
            const opDef: OperationDefinition = {
                kind: "OperationDefinition" as const,
                operation: definition.operation,
                selectionSet: parseSelectionSet(definition.selectionSet),
            };
            if (definition.name) {
                opDef.name = parseName(definition.name);
            }
            if (definition.variableDefinitions) {
                opDef.variableDefinitions = parseVariableDefinitions(definition.variableDefinitions);
            }
            return opDef;
        });
}

function parseVariableDefinitions(variableDefinitions: any[]): VariableDefinition[] {
    return variableDefinitions.map(varDef => ({
        variable: {
            name: parseName(varDef.variable.name),
        },
        type: extractTypeString(varDef.type),
    }));
}

function parseSelectionSet(selectionSet: any): SelectionSet {
    return {
        selections: selectionSet.selections.map((selection: any) => 
            parseField(selection)
        ),
    };
}

function parseField(field: any): Field {
    const fieldObj: Field = {
        kind: "Field" as const,
        name: parseName(field.name),
    };
    if (field.arguments && field.arguments.length > 0) {
        fieldObj.arguments = parseArguments(field.arguments);
    }
    if (field.selectionSet) {
        fieldObj.selectionSet = parseSelectionSet(field.selectionSet);
    }
    return fieldObj;
}

function parseArguments(args: readonly any[]) {
    return args.map(arg => {
        const argObj: any = {
            name: parseName(arg.name),
        };
        if (arg.value.kind === "Variable") {
            argObj.value = { kind: "Variable" as const, name: parseName(arg.value.name) };
        } else {
            argObj.value = { kind: arg.value.kind, value: arg.value.value };
        }
        return argObj;
    });
}

function parseName(nameNode: any): Name {
    return {
        value: nameNode.value,
    };
}

function extractTypeString(typeNode: any): string {
    if (typeNode.kind === "NamedType") {
        return typeNode.name.value;
    } else if (typeNode.kind === "ListType") {
        return `[${extractTypeString(typeNode.type)}]`;
    } else if (typeNode.kind === "NonNullType") {
        return `${extractTypeString(typeNode.type)}!`;
    }
    return "";
}
