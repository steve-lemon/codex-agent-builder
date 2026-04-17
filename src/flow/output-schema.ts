import { AgentError } from '../errors/agent-error';
import yaml from 'js-yaml';

type JsonSchemaLike = {
    type?: string;
    properties?: Record<string, JsonSchemaLike>;
    required?: string[];
    items?: JsonSchemaLike;
    enum?: unknown[];
};

function formatPath(path: string[]): string {
    return path.length > 0 ? path.join('.') : '$';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSchemaNode(value: unknown, schema: JsonSchemaLike, path: string[], issues: string[]): void {
    if (schema.enum && !schema.enum.some(candidate => Object.is(candidate, value))) {
        issues.push(`${formatPath(path)} must be one of: ${schema.enum.map(item => JSON.stringify(item)).join(', ')}`);
    }

    switch (schema.type) {
        case undefined:
            break;
        case 'object':
            if (!isPlainObject(value)) {
                issues.push(`${formatPath(path)} must be an object.`);
                return;
            }
            for (const requiredKey of schema.required ?? []) {
                if (!(requiredKey in value)) {
                    issues.push(`${formatPath([...path, requiredKey])} is required.`);
                }
            }
            for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
                if (key in value) {
                    validateSchemaNode(value[key], childSchema, [...path, key], issues);
                }
            }
            return;
        case 'array':
            if (!Array.isArray(value)) {
                issues.push(`${formatPath(path)} must be an array.`);
                return;
            }
            if (schema.items) {
                value.forEach((item, index) => {
                    validateSchemaNode(item, schema.items as JsonSchemaLike, [...path, String(index)], issues);
                });
            }
            return;
        case 'string':
            if (typeof value !== 'string') {
                issues.push(`${formatPath(path)} must be a string.`);
            }
            return;
        case 'number':
            if (typeof value !== 'number' || Number.isNaN(value)) {
                issues.push(`${formatPath(path)} must be a number.`);
            }
            return;
        case 'integer':
            if (typeof value !== 'number' || !Number.isInteger(value)) {
                issues.push(`${formatPath(path)} must be an integer.`);
            }
            return;
        case 'boolean':
            if (typeof value !== 'boolean') {
                issues.push(`${formatPath(path)} must be a boolean.`);
            }
            return;
        case 'null':
            if (value !== null) {
                issues.push(`${formatPath(path)} must be null.`);
            }
            return;
        default:
            issues.push(`${formatPath(path)} uses unsupported schema type "${schema.type}".`);
            return;
    }
}

export function parseOutputSchema(schemaText: string): JsonSchemaLike {
    const parsed = yaml.load(schemaText);
    if (!isPlainObject(parsed)) {
        throw new AgentError('AI output schema must parse to an object.', {
            code: 'FLOW_AI_OUTPUT_SCHEMA_INVALID',
        });
    }
    return parsed as JsonSchemaLike;
}

export function parseJsonLikeOutput(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return value;
    }

    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
        return value;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

export function validateOutputAgainstSchema(value: unknown, schemaText: string): unknown {
    const parsedValue = parseJsonLikeOutput(value);
    const schema = parseOutputSchema(schemaText);
    const issues: string[] = [];
    validateSchemaNode(parsedValue, schema, [], issues);

    if (issues.length > 0) {
        throw new AgentError(`AI output does not satisfy the configured schema: ${issues.join(' ')}`, {
            code: 'FLOW_AI_OUTPUT_SCHEMA_MISMATCH',
            cause: {
                issues,
                schema,
                value: parsedValue,
            },
        });
    }

    return parsedValue;
}
