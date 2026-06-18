import { AgentError } from '../errors/agent-error';

function collectErrorChain(error: unknown): unknown[] {
    const chain: unknown[] = [];
    let current: unknown = error;

    while (current !== undefined) {
        chain.push(current);

        if (!(current instanceof Error) || !('cause' in current)) {
            break;
        }

        current = (current as Error & { cause?: unknown }).cause;
    }

    return chain;
}

function toMessageParts(error: unknown): string[] {
    return collectErrorChain(error)
        .map(item => {
            if (item instanceof Error) {
                return item.message;
            }
            if (typeof item === 'string') {
                return item;
            }
            if (item && typeof item === 'object' && 'message' in item && typeof (item as { message?: unknown }).message === 'string') {
                return (item as { message: string }).message;
            }
            return '';
        })
        .filter(Boolean);
}

function hasCode(error: unknown, codes: string[]): boolean {
    return collectErrorChain(error).some(item => {
        if (!item || typeof item !== 'object' || !('code' in item)) {
            return false;
        }
        const code = (item as { code?: unknown }).code;
        return typeof code === 'string' && codes.includes(code);
    });
}

function isModelAvailabilityMessage(message: string): boolean {
    return [
        /model.+not found/i,
        /model.+does not exist/i,
        /unknown model/i,
        /unsupported model/i,
        /invalid model/i,
        /no such model/i,
        /model_not_found/i,
        /is not a valid model/i,
    ].some(pattern => pattern.test(message));
}

export function classifyStructuredGatewayError(args: {
    provider: 'openai' | 'gemini';
    model: string;
    schemaName: string;
    error: unknown;
}): AgentError {
    const rootCause = AgentError.rootCause(args.error);
    const joinedMessage = toMessageParts(args.error).join(' | ');
    const schemaLabel = args.schemaName;

    if (
        isModelAvailabilityMessage(joinedMessage) ||
        hasCode(args.error, ['model_not_found', 'MODEL_NOT_FOUND'])
    ) {
        return new AgentError(
            `${args.provider === 'openai' ? 'OpenAI' : 'Gemini'} model is not available for ${schemaLabel}: ${args.model}. Check the model name and whether it supports this structured request.`,
            {
                cause: rootCause,
                code: `${args.provider.toUpperCase()}_MODEL_NOT_AVAILABLE`,
            },
        );
    }

    return new AgentError(
        `${args.provider === 'openai' ? 'OpenAI' : 'Gemini'} structured response parsing failed for ${schemaLabel}`,
        {
            cause: rootCause,
            code: `${args.provider.toUpperCase()}_STRUCTURED_PARSE_FAILED`,
        },
    );
}
