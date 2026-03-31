// Vitest specs for OpenAI structured schema validation rules.
import { describe, expect, it } from 'vitest';
import { AgentError } from '../errors/agent-error';
import { validateOpenAiTextFormat } from './openai-schema-validator';

describe('OpenAI schema validator', () => {
    it('accepts a strict object schema within the supported subset', () => {
        expect(() =>
            validateOpenAiTextFormat({
                type: 'json_schema',
                name: 'valid_payload',
                strict: true,
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        id: { type: 'string' },
                        status: { enum: ['open', 'closed'], type: 'string' },
                        note: { type: ['string', 'null'] },
                    },
                    required: ['id', 'status', 'note'],
                },
            }),
        ).not.toThrow();
    });

    it('rejects schemas that do not use strict mode', () => {
        expect(() =>
            validateOpenAiTextFormat({
                type: 'json_schema',
                name: 'non_strict',
                strict: false,
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {},
                    required: [],
                },
            }),
        ).toThrowError(AgentError);
    });

    it('rejects object schemas without additionalProperties=false', () => {
        expect(() =>
            validateOpenAiTextFormat({
                type: 'json_schema',
                name: 'bad_object',
                strict: true,
                schema: {
                    type: 'object',
                    properties: {
                        value: { type: 'string' },
                    },
                    required: ['value'],
                },
            }),
        ).toThrow(/additionalProperties=false/);
    });

    it('rejects unsupported keywords in nested schemas', () => {
        expect(() =>
            validateOpenAiTextFormat({
                type: 'json_schema',
                name: 'bad_keyword',
                strict: true,
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        value: {
                            type: 'string',
                            patternProperties: {},
                        },
                    },
                    required: ['value'],
                },
            }),
        ).toThrow(/unsupported keyword patternProperties/);
    });

    it('rejects unsupported types', () => {
        expect(() =>
            validateOpenAiTextFormat({
                type: 'json_schema',
                name: 'bad_type',
                strict: true,
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        value: {
                            type: 'date',
                        },
                    },
                    required: ['value'],
                },
            }),
        ).toThrow(/unsupported type date/);
    });
});
