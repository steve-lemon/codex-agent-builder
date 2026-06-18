function getConfiguredProvider(): 'openai' | 'gemini' | 'fake' {
    const explicit = String(process.env.FLOW_RUNTIME_PROVIDER ?? '').toLowerCase();
    if (explicit === 'openai' || explicit === 'gemini' || explicit === 'fake') {
        return explicit;
    }

    const provider = String(process.env.LLM_PROVIDER ?? '').toLowerCase();
    if (provider === 'openai' || provider === 'gemini' || provider === 'fake') {
        return provider;
    }

    if (String(process.env.USE_REAL_GEMINI ?? 'false').toLowerCase() === 'true') {
        return 'gemini';
    }
    if (String(process.env.USE_REAL_OPENAI ?? 'false').toLowerCase() === 'true') {
        return 'openai';
    }

    return 'fake';
}

function getProviderMainModel(provider: 'openai' | 'gemini' | 'fake'): string {
    if (provider === 'openai') {
        return process.env.FLOW_RUNTIME_MAIN_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5-mini';
    }
    if (provider === 'gemini') {
        return process.env.FLOW_RUNTIME_MAIN_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
    }
    return process.env.FLOW_RUNTIME_MAIN_MODEL ?? 'fake-main';
}

function getProviderLiteModel(provider: 'openai' | 'gemini' | 'fake'): string {
    if (provider === 'openai') {
        return process.env.FLOW_RUNTIME_LITE_MODEL ?? process.env.OPENAI_LITE_MODEL ?? 'gpt-4.1-mini';
    }
    if (provider === 'gemini') {
        return process.env.FLOW_RUNTIME_LITE_MODEL ?? process.env.GEMINI_LITE_MODEL ?? 'gemini-2.5-flash-lite';
    }
    return process.env.FLOW_RUNTIME_LITE_MODEL ?? 'fake-lite';
}

/** Resolves runtime model aliases used in manifests into provider-specific concrete model names. */
export function resolveRuntimeModelAlias(model: string): string {
    const provider = getConfiguredProvider();

    switch (model) {
        case 'runtime-main-model':
        case 'runtime-structured-model':
        case 'runtime-blog-model':
            return getProviderMainModel(provider);
        case 'runtime-lite-model':
            return getProviderLiteModel(provider);
        default:
            return model;
    }
}

/** Returns whether a configured model is still clearly fake/mock-like for assessment purposes. */
export function isMockLikeRuntimeModel(model: string): boolean {
    return model.startsWith('mock-') || model === 'fake-main' || model === 'fake-lite';
}
