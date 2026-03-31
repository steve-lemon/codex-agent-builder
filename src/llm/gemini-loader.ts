// Dynamic Gemini SDK loading helpers so fake-mode can run without the package installed.
import { AgentError } from '../errors/agent-error';

/** Minimal shape used from the Gemini SDK response object. */
export interface GeminiGenerateContentResponseLike {
    text?: string;
    promptFeedback?: unknown;
}

/** Minimal shape used from the Gemini SDK client. */
export interface GeminiClientLike {
    models: {
        generateContent(request: unknown): Promise<GeminiGenerateContentResponseLike>;
    };
}

/** Constructor shape for the dynamically loaded Gemini client. */
export interface GoogleGenAiConstructorLike {
    new (options: { apiKey: string }): GeminiClientLike;
}

/** Loader used for the main `@google/genai` package. */
export type GeminiSdkLoader = () => Promise<GoogleGenAiConstructorLike>;

/** Dynamically imports the Gemini client constructor only when Gemini access is needed. */
export async function loadGeminiSdk(): Promise<GoogleGenAiConstructorLike> {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 20) {
        throw new AgentError('@google/genai requires Node.js 20 or newer', {
            code: 'GEMINI_UNSUPPORTED_NODE_VERSION',
        });
    }

    try {
        const module = (await import('@google/genai')) as { GoogleGenAI: GoogleGenAiConstructorLike };
        return module.GoogleGenAI;
    } catch (error) {
        throw new AgentError('@google/genai package is required for Gemini execution', {
            code: 'GEMINI_SDK_MISSING',
            cause: AgentError.rootCause(error),
        });
    }
}
