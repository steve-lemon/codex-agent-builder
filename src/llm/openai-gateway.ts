// LLM gateway interfaces and implementations.
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { parsePlanResponse, PlanResponseSchema, ReflectorOutputSchema } from '../agent/schemas';
import { FinalResultSchema } from '../agent/types';
import type { LlmGateway, PlannerInput, ReflectorInput, FinalizerInput } from './types';
import { AgentError } from '../errors/agent-error';

/** Configuration used to initialize the OpenAI-backed gateway. */
export interface OpenAiGatewayOptions {
    apiKey?: string;
    model?: string;
}

/** Real LLM gateway that delegates structured generation to the OpenAI SDK. */
export class OpenAiGateway implements LlmGateway {
    private readonly client: OpenAI;
    private readonly model: string;

    constructor(options: OpenAiGatewayOptions = {}) {
        const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new AgentError('OPENAI_API_KEY is required for OpenAiGateway');
        }

        this.client = new OpenAI({ apiKey });
        this.model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
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
            PlanResponseSchema,
            'plan',
        );

        return parsePlanResponse(parsed);
    }

    async reflect(input: ReflectorInput) {
        return this.parseStructuredResponse(
            [
                { role: 'system', content: 'Decide whether run is complete.' },
                { role: 'user', content: JSON.stringify(input) },
            ],
            ReflectorOutputSchema,
            'reflector_output',
        );
    }

    async finalize(input: FinalizerInput) {
        return this.parseStructuredResponse(
            [
                { role: 'system', content: 'Return final concise agent result.' },
                { role: 'user', content: JSON.stringify(input) },
            ],
            FinalResultSchema,
            'final_result',
        );
    }

    /** Uses the recommended Responses API structured parsing flow for new SDK integrations. */
    private async parseStructuredResponse<TSchema extends z.ZodTypeAny>(
        input: Array<{ role: 'system' | 'user'; content: string }>,
        schema: TSchema,
        schemaName: string,
    ): Promise<z.output<TSchema>> {
        const response = await this.client.responses.parse({
            model: this.model,
            input,
            text: {
                // The SDK helper has very deep conditional types in v6, so keep this boundary shallow.
                format: zodTextFormat(schema as never, schemaName),
            },
        });

        if (response.output_parsed === null) {
            throw new AgentError('OpenAI returned no structured output', {
                cause: response,
                code: 'OPENAI_STRUCTURED_OUTPUT_MISSING',
            });
        }

        return schema.parse(response.output_parsed) as z.output<TSchema>;
    }
}
