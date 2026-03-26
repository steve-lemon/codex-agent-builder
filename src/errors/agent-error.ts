// Shared error primitives for the agent runtime.
/** Standard runtime error that preserves the root cause chain. */
export class AgentError extends Error {
  readonly code?: string;
  readonly transient: boolean;
  readonly cause?: unknown;

  constructor(
    message: string,
    options?: {
      cause?: unknown;
      code?: string;
      transient?: boolean;
    }
  ) {
    super(message);
    this.name = 'AgentError';
    this.code = options?.code;
    this.transient = options?.transient ?? false;
    this.cause = options?.cause;
  }

  /** Returns the deepest known cause for an error chain. */
  static rootCause(error: unknown): unknown {
    let current = error;
    while (
      current instanceof Error &&
      'cause' in current &&
      (current as Error & { cause?: unknown }).cause !== undefined
    ) {
      current = (current as Error & { cause?: unknown }).cause;
    }
    return current;
  }

  /** Wraps any thrown value as an AgentError while preserving the root cause. */
  static from(error: unknown, fallbackMessage = 'Agent execution failed'): AgentError {
    if (error instanceof AgentError) {
      return new AgentError(error.message, {
        cause: AgentError.rootCause(error),
        code: error.code,
        transient: error.transient
      });
    }

    if (error instanceof Error) {
      return new AgentError(error.message, {
        cause: AgentError.rootCause(error)
      });
    }

    return new AgentError(fallbackMessage, {
      cause: error
    });
  }
}
