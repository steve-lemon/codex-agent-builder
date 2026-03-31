// Structured response parser strategies for local SDK and proxy execution.
import { z } from 'zod';
import { AgentError } from '../errors/agent-error';
import {
    deserializeStructuredSchema,
    type SerializedStructuredSchema,
    type StructuredSchema,
} from './structured-schema';
import type { OpenAiClientLike, OpenAiSdkLoader, OpenAiZodHelpersLoader } from './openai-loader';
import { validateOpenAiTextFormat } from './openai-schema-validator';

/** Shared request shape for structured parsing regardless of transport. */
export interface StructuredParseRequest<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
    model: string;
    input: Array<{ role: 'system' | 'user'; content: string }>;
    schema: StructuredSchema<TSchema>;
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

/** Strategy interface for obtaining structured model output. */
export interface StructuredResponseParser {
    parse<TSchema extends z.ZodTypeAny>(request: StructuredParseRequest<TSchema>): Promise<unknown>;
}

/** Local parser that executes structured parsing through the OpenAI SDK. */
export class LocalOpenAiStructuredResponseParser implements StructuredResponseParser {
    private client?: OpenAiClientLike;

    constructor(
        private readonly options: {
            apiKey?: string;
            loadSdk: OpenAiSdkLoader;
            loadZodHelpers: OpenAiZodHelpersLoader;
        },
    ) {}

    async parse<TSchema extends z.ZodTypeAny>(request: StructuredParseRequest<TSchema>): Promise<unknown> {
        const client = await this.getClient();
        const { zodTextFormat } = await this.options.loadZodHelpers();
        const format = zodTextFormat(request.schema.schema as never, request.schema.name);
        validateOpenAiTextFormat(format);
        const response = await client.responses.parse({
            model: request.model,
            input: request.input,
            text: {
                // Keep helper typing shallow to avoid deep generic instantiation in the SDK boundary.
                format,
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

    /** Lazily initializes the OpenAI client so non-local paths do not require the SDK. */
    private async getClient(): Promise<OpenAiClientLike> {
        if (this.client) {
            return this.client;
        }

        if (!this.options.apiKey) {
            throw new AgentError('OPENAI_API_KEY is required for local OpenAI execution', {
                code: 'OPENAI_API_KEY_MISSING',
            });
        }

        const OpenAI = await this.options.loadSdk();
        this.client = new OpenAI({ apiKey: this.options.apiKey });
        return this.client;
    }
}

/** Proxy parser that delegates structured parsing to an external HTTP server. */
export class ProxyStructuredResponseParser implements StructuredResponseParser {
    constructor(
        private readonly options: {
            proxyUrl: string;
            fetchImpl?: typeof fetch;
        },
    ) {}

    async parse<TSchema extends z.ZodTypeAny>(request: StructuredParseRequest<TSchema>): Promise<unknown> {
        if (!this.options.fetchImpl) {
            throw new AgentError('fetch is required when using OPENAI_STRUCTURED_PROXY_URL', {
                code: 'OPENAI_PROXY_FETCH_MISSING',
            });
        }

        const serializedSchema = request.schema.serialize();
        const response = await this.options.fetchImpl(this.options.proxyUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: request.model,
                input: request.input,
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
