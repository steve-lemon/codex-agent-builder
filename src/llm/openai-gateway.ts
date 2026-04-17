// LLM gateway interfaces and implementations.
import { z } from 'zod';
import type { LlmGateway, PlannerInput, ReflectorInput, FinalizerInput, StructuredGenerationInput } from './types';
import { AgentError } from '../errors/agent-error';
import type { StructuredSchema } from './structured-schema';
import {
    loadOpenAiSdk,
    loadOpenAiZodHelpers,
    type OpenAiSdkLoader,
    type OpenAiZodHelpersLoader,
} from './openai-loader';
import {
    LocalOpenAiStructuredResponseParser,
    ProxyStructuredResponseParser,
    type StructuredResponseParser,
} from './structured-response-parser';
import {
    buildFinalizeStructuredRequest,
    buildPlanStructuredRequest,
    buildReflectStructuredRequest,
    parsePlanStructuredOutput,
} from './structured-tasks';

/** Configuration used to initialize the OpenAI-backed gateway. */
export interface OpenAiGatewayOptions {
    apiKey?: string;
    model?: string;
    proxyUrl?: string;
    fetchImpl?: typeof fetch;
    loadSdk?: OpenAiSdkLoader;
    loadZodHelpers?: OpenAiZodHelpersLoader;
    parser?: StructuredResponseParser;
}

/** Real LLM gateway that delegates structured generation through a pluggable parser strategy. */
export class OpenAiGateway implements LlmGateway {
    private readonly model: string;
    private readonly parser: StructuredResponseParser;

    constructor(options: OpenAiGatewayOptions = {}) {
        this.model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
        this.parser =
            options.parser ??
            (options.proxyUrl ?? process.env.OPENAI_STRUCTURED_PROXY_URL
                ? new ProxyStructuredResponseParser({
                      proxyUrl: options.proxyUrl ?? process.env.OPENAI_STRUCTURED_PROXY_URL!,
                      fetchImpl: options.fetchImpl ?? globalThis.fetch,
                  })
                : new LocalOpenAiStructuredResponseParser({
                      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
                      loadSdk: options.loadSdk ?? loadOpenAiSdk,
                      loadZodHelpers: options.loadZodHelpers ?? loadOpenAiZodHelpers,
                  }));
    }

    async plan(input: PlannerInput) {
        const parsed = await this.generateStructured(await buildPlanStructuredRequest(input));

        return parsePlanStructuredOutput(parsed);
    }

    async reflect(input: ReflectorInput) {
        return this.generateStructured(await buildReflectStructuredRequest(input));
    }

    async finalize(input: FinalizerInput) {
        return this.generateStructured(await buildFinalizeStructuredRequest(input));
    }

    async generateStructured<TSchema extends z.ZodTypeAny>(
        request: StructuredGenerationInput<TSchema>,
    ): Promise<z.output<TSchema>> {
        return this.parseStructuredResponse(request.input, request.schema);
    }

    /** Normalizes parser errors and re-validates output against the requested schema. */
    private async parseStructuredResponse<TSchema extends z.ZodTypeAny>(
        input: Array<{ role: 'system' | 'user'; content: string }>,
        schema: StructuredSchema<TSchema>,
    ): Promise<z.output<TSchema>> {
        try {
            const output = await this.parser.parse({
                model: this.model,
                input,
                schema,
            });

            return schema.parse(output);
        } catch (error) {
            throw new AgentError(`Structured response parsing failed for ${schema.name}`, {
                cause: AgentError.rootCause(error),
                code: 'OPENAI_STRUCTURED_PARSE_FAILED',
            });
        }
    }
}
