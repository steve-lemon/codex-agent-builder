// Dynamic OpenAI SDK loading helpers so fake-mode can run without the package installed.
import { AgentError } from '../errors/agent-error';
import type { OpenAiTextFormat } from './openai-schema-validator';

/** Minimal shape used from the OpenAI SDK client. */
export interface OpenAiClientLike {
    responses: {
        parse(request: unknown): Promise<{ output_parsed: unknown | null }>;
    };
}

/** Constructor shape for the dynamically loaded OpenAI client. */
export interface OpenAiConstructorLike {
    new (options: { apiKey: string }): OpenAiClientLike;
}

/** Minimal helper shape used from `openai/helpers/zod`. */
export interface OpenAiZodHelpersLike {
    zodTextFormat(schema: unknown, schemaName: string): OpenAiTextFormat;
    zodResponseFormat(
        schema: unknown,
        schemaName: string,
    ): {
        type: string;
        json_schema: {
            name: string;
            strict: boolean;
            schema: Record<string, unknown>;
        };
    };
}

/** Loader used for the main `openai` package. */
export type OpenAiSdkLoader = () => Promise<OpenAiConstructorLike>;

/** Loader used for the OpenAI zod helper module. */
export type OpenAiZodHelpersLoader = () => Promise<OpenAiZodHelpersLike>;

/** Dynamically imports the OpenAI client constructor only when local SDK access is needed. */
export async function loadOpenAiSdk(): Promise<OpenAiConstructorLike> {
    try {
        const module = (await import('openai')) as { default: OpenAiConstructorLike };
        return module.default;
    } catch (error) {
        throw new AgentError('openai package is required for local OpenAI execution', {
            code: 'OPENAI_SDK_MISSING',
            cause: AgentError.rootCause(error),
        });
    }
}

/** Dynamically imports OpenAI zod helpers only when structured SDK formatting is needed. */
export async function loadOpenAiZodHelpers(): Promise<OpenAiZodHelpersLike> {
    try {
        const newLocal_1 = 'openai/helpers/zod';
        return (await import(newLocal_1)) as OpenAiZodHelpersLike;
    } catch (error) {
        throw new AgentError('openai/helpers/zod is required for local structured OpenAI execution', {
            code: 'OPENAI_ZOD_HELPERS_MISSING',
            cause: AgentError.rootCause(error),
        });
    }
}
