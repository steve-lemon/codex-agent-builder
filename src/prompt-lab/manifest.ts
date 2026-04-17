import { loadResource } from '../resources/loader';
import type { PromptLabLanguageCopy, PromptLabManifestRecord, PromptLabModelOption } from './manifest-schemas';
import type { PromptLabProvider } from './types';

let manifestPromise: Promise<PromptLabManifestRecord> | undefined;

export async function getPromptLabManifest(): Promise<PromptLabManifestRecord> {
    manifestPromise ??= loadResource('prompt-lab.manifest');
    return await manifestPromise;
}

export async function getPromptLabLanguageCopy(language: string): Promise<PromptLabLanguageCopy> {
    const manifest = await getPromptLabManifest();
    return manifest.cli.languages[language] ?? manifest.cli.languages[manifest.defaults.language]!;
}

export async function getPromptLabModelOptions(
    provider: PromptLabProvider,
): Promise<{ main: PromptLabModelOption[]; lite: PromptLabModelOption[] }> {
    const manifest = await getPromptLabManifest();
    return manifest.cli.models[provider];
}
