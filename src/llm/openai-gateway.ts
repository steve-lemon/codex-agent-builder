// LLM gateway interfaces and implementations.
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { parsePlanResponse, PlanResponseSchema, ReflectorOutputSchema } from '../agent/schemas';
import { FinalResultSchema } from '../agent/types';
import type { LlmGateway, PlannerInput, ReflectorInput, FinalizerInput } from './types';
import { AgentError } from '../errors/agent-error';
import {
    defineStructuredSchema,
    deserializeStructuredSchema,
    type SerializedStructuredSchema,
    type StructuredSchema,
} from './structured-schema';

/** Configuration used to initialize the OpenAI-backed gateway. */
export interface OpenAiGatewayOptions {
    apiKey?: string;
    model?: string;
    proxyUrl?: string;
    fetchImpl?: typeof fetch;
}

/** Real LLM gateway that delegates structured generation to the OpenAI SDK. */
export class OpenAiGateway implements LlmGateway {
    private readonly client: OpenAI;
    private readonly model: string;
    private readonly proxyUrl?: string;
    private readonly fetchImpl?: typeof fetch;

    constructor(options: OpenAiGatewayOptions = {}) {
        const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new AgentError('OPENAI_API_KEY is required for OpenAiGateway');
        }

        this.client = new OpenAI({ apiKey });
        this.model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
        this.proxyUrl = options.proxyUrl ?? process.env.OPENAI_STRUCTURED_PROXY_URL;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    }

    async plan(input: PlannerInput) {
        const parsed = await this.parseStructuredResponse(
            [
                {
                    role: 'system',
                    content: 'Return a concise executable plan for an agent runtime. Use only provided tools.',
                },
                { role: 'user', content: JSON.stringify(input) },
            ],
            defineStructuredSchema('plan', PlanResponseSchema),
        );

        return parsePlanResponse(parsed);
    }

    async reflect(input: ReflectorInput) {
        return this.parseStructuredResponse(
            [
                { role: 'system', content: 'Decide whether run is complete.' },
                { role: 'user', content: JSON.stringify(input) },
            ],
            defineStructuredSchema('reflector_output', ReflectorOutputSchema),
        );
    }

    async finalize(input: FinalizerInput) {
        return this.parseStructuredResponse(
            [
                { role: 'system', content: 'Return final concise agent result.' },
                { role: 'user', content: JSON.stringify(input) },
            ],
            defineStructuredSchema('final_result', FinalResultSchema),
        );
    }

    /** Uses the local SDK or an HTTP proxy to obtain structured model output from the same schema contract. */
    private async parseStructuredResponse<TSchema extends z.ZodTypeAny>(
        input: Array<{ role: 'system' | 'user'; content: string }>,
        schema: StructuredSchema<TSchema>,
    ): Promise<z.output<TSchema>> {
        try {
            const output = this.proxyUrl
                ? await this.parseStructuredResponseViaProxy(input, schema)
                : await this.parseStructuredResponseLocally(input, schema);

            return schema.parse(output);
        } catch (error) {
            throw new AgentError(`Structured response parsing failed for ${schema.name}`, {
                cause: AgentError.rootCause(error),
                code: 'OPENAI_STRUCTURED_PARSE_FAILED',
            });
        }
    }

    /** Performs the structured parse locally through the OpenAI SDK. */
    private async parseStructuredResponseLocally<TSchema extends z.ZodTypeAny>(
        input: Array<{ role: 'system' | 'user'; content: string }>,
        schema: StructuredSchema<TSchema>,
    ): Promise<unknown> {
        const response = await this.client.responses.parse({
            model: this.model,
            input,
            text: {
                // The SDK helper has very deep conditional types in v6, so keep this boundary shallow.
                format: zodTextFormat(schema.schema as never, schema.name),
            },
        });

        if (response.output_parsed === null) {
            throw new AgentError('OpenAI returned no structured output', {
                cause: response,
                code: 'OPENAI_STRUCTURED_OUTPUT_MISSING',
            });
        }

        return response.output_parsed;
    }

    /** Proxies structured parsing to an external HTTP service using serialized schema metadata. */
    private async parseStructuredResponseViaProxy<TSchema extends z.ZodTypeAny>(
        input: Array<{ role: 'system' | 'user'; content: string }>,
        schema: StructuredSchema<TSchema>,
    ): Promise<unknown> {
        if (!this.fetchImpl) {
            throw new AgentError('fetch is required when using OPENAI_STRUCTURED_PROXY_URL', {
                code: 'OPENAI_PROXY_FETCH_MISSING',
            });
        }

        const serializedSchema = schema.serialize();
        const response = await this.fetchImpl(this.proxyUrl!, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                input,
                schema: serializedSchema,
            } satisfies StructuredParseProxyRequest),
        });

        if (!response.ok) {
            throw new AgentError(`Structured proxy request failed with status ${response.status}`, {
                code: 'OPENAI_PROXY_HTTP_ERROR',
            });
        }

        const payload = StructuredParseProxyResponseSchema.parse(await response.json());
        const deserializedSchema = deserializeStructuredSchema(serializedSchema);
        return deserializedSchema.parse(payload.output);
    }
}

/** Transport payload sent to an external structured-output proxy server. */
export interface StructuredParseProxyRequest {
    model: string;
    input: Array<{ role: 'system' | 'user'; content: string }>;
    schema: SerializedStructuredSchema;
}

const StructuredParseProxyResponseSchema = z.object({
    output: z.unknown(),
});
