import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getPromptLabLanguageCopy, getPromptLabManifest } from './manifest';
import { PromptLabProduct } from './product';
import type { PromptLabLanguage, PromptLabProvider, PromptLabSessionConfig } from './types';
import type { ProductFlowSkill } from '../product/types';

function normalizeLanguage(value: string, fallback: PromptLabLanguage): PromptLabLanguage {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'en' || normalized === 'en-us') {
        return 'en';
    }
    if (normalized === 'ko' || normalized === 'ko-kr' || normalized === '') {
        return fallback;
    }
    return fallback;
}

function resolveDefaultProvider(providerOrder: PromptLabProvider[]): PromptLabProvider {
    if (process.env.OPENAI_API_KEY) {
        return providerOrder.includes('openai') ? 'openai' : providerOrder[0]!;
    }
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
        return providerOrder.includes('gemini') ? 'gemini' : providerOrder[0]!;
    }
    return providerOrder[0]!;
}

function defaultMainModel(provider: PromptLabProvider): string {
    if (provider === 'openai') {
        return process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
    }
    if (provider === 'gemini') {
        return process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
    }
    return 'fake-main';
}

function defaultLiteModel(provider: PromptLabProvider, mainModel: string): string {
    if (provider === 'openai') {
        return process.env.OPENAI_LITE_MODEL ?? mainModel;
    }
    if (provider === 'gemini') {
        return process.env.GEMINI_LITE_MODEL ?? mainModel;
    }
    return 'fake-lite';
}

async function readMultilineFeedback(rl: ReturnType<typeof createInterface>, prompt: string, doneHint: string): Promise<string> {
    output.write(`${prompt}\n${doneHint}\n`);
    const lines: string[] = [];
    while (true) {
        const line = await rl.question('> ');
        if (line.trim() === '') {
            break;
        }
        lines.push(line);
    }
    return lines.join('\n');
}

function normalizeSkill(value: string, fallback: ProductFlowSkill): ProductFlowSkill {
    const normalized = value.trim().toLowerCase();
    if (
        normalized === 'flow-preflight-validator' ||
        normalized === 'flow-designer' ||
        normalized === 'node-config-designer'
    ) {
        return normalized;
    }
    return fallback;
}

async function main() {
    const manifest = await getPromptLabManifest();
    const defaultLanguage = manifest.defaults.language as PromptLabLanguage;
    const rl = createInterface({ input, output });

    try {
        const languageInput = await rl.question(`${(await getPromptLabLanguageCopy(defaultLanguage)).languagePrompt} [${defaultLanguage}]: `);
        const language = normalizeLanguage(languageInput, defaultLanguage);
        const copy = await getPromptLabLanguageCopy(language);

        output.write(`${copy.welcome}\n`);
        const defaultProvider = resolveDefaultProvider(manifest.defaults.providerOrder);
        const providerInput = await rl.question(`${copy.providerPrompt} [${defaultProvider}]: `);
        const provider = (providerInput.trim().toLowerCase() || defaultProvider) as PromptLabProvider;
        const defaultSkill = manifest.defaults.skillName;
        const skillInput = await rl.question(`${copy.skillPrompt} [${defaultSkill}]: `);
        const skillName = normalizeSkill(skillInput, defaultSkill);
        const mainModelDefault = defaultMainModel(provider);
        const mainModel = (await rl.question(`${copy.mainModelPrompt} [${mainModelDefault}]: `)).trim() || mainModelDefault;
        const liteModelDefault = defaultLiteModel(provider, mainModel);
        const liteModel = (await rl.question(`${copy.liteModelPrompt} [${liteModelDefault}]: `)).trim() || liteModelDefault;
        const requirement = (await rl.question(`${copy.requirementPrompt}\n> `)).trim();
        if (!requirement) {
            throw new Error('Requirement is required.');
        }

        output.write(`${copy.startMessage}\n`);
        const product = new PromptLabProduct();
        const config: PromptLabSessionConfig = {
            provider,
            mainModel,
            liteModel,
            language,
            skillName,
            outputRoot: manifest.defaults.outputRoot,
        };

        const { session, result, gateway } = await product.runRequirement({ config, requirement });
        const selfReview = await product.createSelfReview({ session, result, gateway });

        output.write(`${copy.selfReviewMessage}\n`);
        output.write(`${selfReview.summary}\n`);
        const feedback = await readMultilineFeedback(rl, copy.feedbackPrompt, copy.feedbackDoneHint);

        const artifacts = await product.finalizeSession({
            session,
            result,
            selfReview,
            userFeedback: feedback,
            gateway,
        });

        output.write(`${copy.finalPromptMessage}\n`);
        output.write(`${artifacts.codexPrompt.codexPrompt}\n\n`);
        output.write(`${copy.completionMessage} ${session.sessionDir}\n`);
    } finally {
        rl.close();
    }
}

void main();
