// Gemini-backed LLM gateway implementation.
import { z } from 'zod';
import type { FinalizerInput, LlmGateway, PlannerInput, ReflectorInput, StructuredGenerationInput } from './types';
import { AgentError } from '../errors/agent-error';
import { serializeZodSchema } from '../schema/json-schema';
import { loadGeminiSdk, type GeminiClientLike, type GeminiSdkLoader } from './gemini-loader';
import {
    buildFinalizeStructuredRequest,
    buildPlanStructuredRequest,
    buildReflectStructuredRequest,
    parsePlanStructuredOutput,
} from './structured-tasks';

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
        const parsed = await this.generateStructured(buildPlanStructuredRequest(input));

        return parsePlanStructuredOutput(parsed);
    }

    async reflect(input: ReflectorInput) {
        return this.generateStructured(buildReflectStructuredRequest(input));
    }

    async finalize(input: FinalizerInput) {
        return this.generateStructured(buildFinalizeStructuredRequest(input));
    }

    async generateStructured<TSchema extends z.ZodTypeAny>(
        request: StructuredGenerationInput<TSchema>,
    ): Promise<z.output<TSchema>> {
        return this.generateStructuredContent(
            request.input.find(message => message.role === 'system')?.content ?? '',
            request.input.find(message => message.role === 'user')?.content
                ? JSON.parse(request.input.find(message => message.role === 'user')!.content)
                : {},
            request.schema.schema,
            request.schema.name,
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
