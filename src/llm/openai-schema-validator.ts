// Validation helpers for OpenAI structured-output schema compatibility.
import { AgentError } from '../errors/agent-error';

type JsonSchemaNode = Record<string, unknown>;

/** Minimal text-format shape returned by `openai/helpers/zod`. */
export interface OpenAiTextFormat {
    type: 'json_schema';
    name: string;
    strict: boolean;
    schema: JsonSchemaNode;
}

const SUPPORTED_TYPES = new Set(['string', 'number', 'boolean', 'integer', 'object', 'array', 'null']);
const UNSUPPORTED_KEYWORDS = new Set([
    'allOf',
    'oneOf',
    'not',
    'if',
    'then',
    'else',
    'dependentRequired',
    'dependentSchemas',
    'patternProperties',
    'unevaluatedProperties',
    'unevaluatedItems',
]);

/** Validates that an OpenAI text-format schema stays within the documented structured-output subset. */
export function validateOpenAiTextFormat(format: OpenAiTextFormat): void {
    if (format.type !== 'json_schema') {
        throw new AgentError('OpenAI text format must use json_schema', {
            code: 'OPENAI_SCHEMA_INVALID_FORMAT',
        });
    }

    if (!format.strict) {
        throw new AgentError(`OpenAI text format ${format.name} must use strict mode`, {
            code: 'OPENAI_SCHEMA_NOT_STRICT',
        });
    }

    const metrics = {
        depth: 0,
        properties: 0,
        enumValues: 0,
        stringBudget: 0,
    };

    validateSchemaNode(format.schema, format.name, '$', 1, metrics);

    if (metrics.depth > 10) {
        throw new AgentError(`OpenAI schema ${format.name} exceeds max depth of 10`, {
            code: 'OPENAI_SCHEMA_TOO_DEEP',
        });
    }

    if (metrics.properties > 5000) {
        throw new AgentError(`OpenAI schema ${format.name} exceeds max property count`, {
            code: 'OPENAI_SCHEMA_TOO_LARGE',
        });
    }

    if (metrics.enumValues > 1000) {
        throw new AgentError(`OpenAI schema ${format.name} exceeds enum value limit`, {
            code: 'OPENAI_SCHEMA_TOO_MANY_ENUMS',
        });
    }

    if (metrics.stringBudget > 120000) {
        throw new AgentError(`OpenAI schema ${format.name} exceeds string budget`, {
            code: 'OPENAI_SCHEMA_STRING_BUDGET_EXCEEDED',
        });
    }
}

function validateSchemaNode(
    node: JsonSchemaNode,
    schemaName: string,
    path: string,
    depth: number,
    metrics: {
        depth: number;
        properties: number;
        enumValues: number;
        stringBudget: number;
    },
): void {
    metrics.depth = Math.max(metrics.depth, depth);

    for (const key of Object.keys(node)) {
        metrics.stringBudget += key.length;
        if (UNSUPPORTED_KEYWORDS.has(key)) {
            throw new AgentError(`OpenAI schema ${schemaName} uses unsupported keyword ${key} at ${path}`, {
                code: 'OPENAI_SCHEMA_UNSUPPORTED_KEYWORD',
            });
        }
    }

    const nodeType = node.type;
    const anyOf = node.anyOf;

    if (nodeType !== undefined) {
        validateTypeValue(nodeType, schemaName, path);
    } else if (!Array.isArray(anyOf) && node.enum === undefined && node.properties === undefined) {
        throw new AgentError(`OpenAI schema ${schemaName} is missing a supported type at ${path}`, {
            code: 'OPENAI_SCHEMA_MISSING_TYPE',
        });
    }

    if (node.enum !== undefined) {
        if (!Array.isArray(node.enum)) {
            throw new AgentError(`OpenAI schema ${schemaName} has invalid enum at ${path}`, {
                code: 'OPENAI_SCHEMA_INVALID_ENUM',
            });
        }

        metrics.enumValues += node.enum.length;
        for (const value of node.enum) {
            if (typeof value === 'string') {
                metrics.stringBudget += value.length;
            }
        }
    }

    if (Array.isArray(anyOf)) {
        for (const [index, child] of anyOf.entries()) {
            validateChildNode(child, schemaName, `${path}.anyOf[${index}]`, depth + 1, metrics);
        }
    }

    if (node.properties !== undefined) {
        if (!isRecord(node.properties)) {
            throw new AgentError(`OpenAI schema ${schemaName} has invalid properties at ${path}`, {
                code: 'OPENAI_SCHEMA_INVALID_PROPERTIES',
            });
        }

        if (node.additionalProperties !== false) {
            throw new AgentError(`OpenAI object schema ${schemaName} must set additionalProperties=false at ${path}`, {
                code: 'OPENAI_SCHEMA_ADDITIONAL_PROPERTIES_REQUIRED_FALSE',
            });
        }

        const properties = node.properties;
        metrics.properties += Object.keys(properties).length;
        for (const [key, child] of Object.entries(properties)) {
            metrics.stringBudget += key.length;
            validateChildNode(child, schemaName, `${path}.properties.${key}`, depth + 1, metrics);
        }
    }

    if (node.items !== undefined) {
        validateChildNode(node.items, schemaName, `${path}.items`, depth + 1, metrics);
    }

    if (node.additionalProperties !== undefined && node.additionalProperties !== false) {
        validateChildNode(node.additionalProperties, schemaName, `${path}.additionalProperties`, depth + 1, metrics);
    }
}

function validateTypeValue(typeValue: unknown, schemaName: string, path: string): void {
    const values = Array.isArray(typeValue) ? typeValue : [typeValue];
    for (const value of values) {
        if (typeof value !== 'string' || !SUPPORTED_TYPES.has(value)) {
            throw new AgentError(`OpenAI schema ${schemaName} uses unsupported type ${String(value)} at ${path}`, {
                code: 'OPENAI_SCHEMA_UNSUPPORTED_TYPE',
            });
        }
    }
}

function validateChildNode(
    child: unknown,
    schemaName: string,
    path: string,
    depth: number,
    metrics: {
        depth: number;
        properties: number;
        enumValues: number;
        stringBudget: number;
    },
): void {
    if (!isRecord(child)) {
        throw new AgentError(`OpenAI schema ${schemaName} has invalid child node at ${path}`, {
            code: 'OPENAI_SCHEMA_INVALID_CHILD',
        });
    }

    validateSchemaNode(child, schemaName, path, depth, metrics);
}

function isRecord(value: unknown): value is JsonSchemaNode {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
