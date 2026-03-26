// LLM gateway interfaces and implementations.
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { PlanSchema, ReflectorOutputSchema } from '../agent/schemas';
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
    const completion = await this.client.chat.completions.parse({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'Return a concise executable plan for an agent runtime. Use only provided tools.'
        },
        { role: 'user', content: JSON.stringify(input) }
      ],
      response_format: zodResponseFormat(PlanSchema, 'Plan')
    });

    const parsed = completion.choices[0]?.message?.parsed;
    return PlanSchema.parse(parsed);
  }

  async reflect(input: ReflectorInput) {
    const completion = await this.client.chat.completions.parse({
      model: this.model,
      messages: [
        { role: 'system', content: 'Decide whether run is complete.' },
        { role: 'user', content: JSON.stringify(input) }
      ],
      response_format: zodResponseFormat(ReflectorOutputSchema, 'ReflectorOutput')
    });

    const parsed = completion.choices[0]?.message?.parsed;
    return ReflectorOutputSchema.parse(parsed);
  }

  async finalize(input: FinalizerInput) {
    const completion = await this.client.chat.completions.parse({
      model: this.model,
      messages: [
        { role: 'system', content: 'Return final concise agent result.' },
        { role: 'user', content: JSON.stringify(input) }
      ],
      response_format: zodResponseFormat(FinalResultSchema, 'FinalResult')
    });

    const parsed = completion.choices[0]?.message?.parsed;
    return FinalResultSchema.parse(parsed);
  }
}
