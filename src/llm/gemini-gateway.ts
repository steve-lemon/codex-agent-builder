// Gemini-backed LLM gateway implementation.
import { z } from 'zod';
import { createOpenAiPlanResponseSchema, parsePlanResponse, ReflectorOutputSchema } from '../agent/schemas';
import { FinalResultSchema } from '../agent/types';
import type { FinalizerInput, LlmGateway, PlannerInput, ReflectorInput } from './types';
import { AgentError } from '../errors/agent-error';
import { serializeZodSchema } from '../schema/json-schema';
import { loadGeminiSdk, type GeminiClientLike, type GeminiSdkLoader } from './gemini-loader';

/** Configuration used to initialize the Gemini-backed gateway. */
export interface GeminiGatewayOptions {
    apiKey?: string;
    model?: string;
    loadSdk?: GeminiSdkLoader;
}

/** Real LLM gateway that delegates structured generation to the Gemini SDK. */
export class GeminiGateway implements LlmGateway {
    private client?: GeminiClientLike;
    private readonly apiKey?: string;
    private readonly model: string;
    private readonly loadSdk: GeminiSdkLoader;

    constructor(options: GeminiGatewayOptions = {}) {
        this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
        this.model = options.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
        this.loadSdk = options.loadSdk ?? loadGeminiSdk;
    }

    async plan(input: PlannerInput) {
        const planResponseSchema = createOpenAiPlanResponseSchema(input.toolDefinitions);
        const parsed = await this.generateStructuredContent(
            'Return a concise executable plan for an agent runtime. Use only provided tools and generate tool args that satisfy each tool parameter schema.',
            {
                userInput: input.userInput,
                skillName: input.skillName,
                skillInstructions: input.skillInstructions,
                allowedTools: input.allowedTools,
                toolManifests: input.toolManifests,
            },
            planResponseSchema,
            'plan',
        );

        return parsePlanResponse(parsed);
    }

    async reflect(input: ReflectorInput) {
        return this.generateStructuredContent(
            'Decide whether run is complete.',
            input,
            ReflectorOutputSchema,
            'reflector_output',
        );
    }

    async finalize(input: FinalizerInput) {
        return this.generateStructuredContent(
            'Return final concise agent result.',
            input,
            FinalResultSchema,
            'final_result',
        );
    }

    /** Uses Gemini JSON schema structured output and validates the response payload locally. */
    private async generateStructuredContent<TSchema extends z.ZodTypeAny>(
        systemInstruction: string,
        payload: unknown,
        schema: TSchema,
        schemaName: string,
    ): Promise<z.output<TSchema>> {
        try {
            const client = await this.getClient();
            const response = await client.models.generateContent({
                model: this.model,
                contents: JSON.stringify(payload),
                config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseJsonSchema: serializeZodSchema(schemaName, schema),
                },
            });

            if (!response.text) {
                throw new AgentError('Gemini returned no structured output text', {
                    code: 'GEMINI_STRUCTURED_OUTPUT_MISSING',
                    cause: response.promptFeedback ?? response,
                });
            }

            const parsedJson = JSON.parse(response.text);
            return schema.parse(parsedJson) as z.output<TSchema>;
        } catch (error) {
            throw new AgentError(`Gemini structured response parsing failed for ${schemaName}`, {
                cause: AgentError.rootCause(error),
                code: 'GEMINI_STRUCTURED_PARSE_FAILED',
            });
        }
    }

    /** Lazily initializes the Gemini client so fake-mode does not require the SDK. */
    private async getClient(): Promise<GeminiClientLike> {
        if (this.client) {
            return this.client;
        }

        if (!this.apiKey) {
            throw new AgentError('GEMINI_API_KEY or GOOGLE_API_KEY is required for Gemini execution', {
                code: 'GEMINI_API_KEY_MISSING',
            });
        }

        const GoogleGenAI = await this.loadSdk();
        this.client = new GoogleGenAI({ apiKey: this.apiKey });
        return this.client;
    }
}
