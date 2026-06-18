export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticEvent {
    scope: string;
    action: string;
    message: string;
    data?: Record<string, unknown>;
}

export interface DiagnosticLogger {
    log(level: DiagnosticLevel, event: DiagnosticEvent): void;
}

export type DiagnosticListener = (level: DiagnosticLevel, event: DiagnosticEvent) => void;

// TODO(diagnostics): Add listener subscription metadata or channels so product
// code can route resource diagnostics, flow-design diagnostics, and runtime
// diagnostics to different sinks without filtering everything in one callback.

class ConsoleDiagnosticLogger implements DiagnosticLogger {
    log(level: DiagnosticLevel, event: DiagnosticEvent): void {
        const prefix = `[${event.scope}] ${event.action}: ${event.message}`;
        const payload = event.data ? ` ${safeSerialize(event.data)}` : '';
        const line = `${prefix}${payload}`;
        if (level === 'debug') {
            console.debug(line);
            return;
        }
        if (level === 'info') {
            console.info(line);
            return;
        }
        if (level === 'warn') {
            console.warn(line);
            return;
        }
        console.error(line);
    }
}

let activeDiagnosticLogger: DiagnosticLogger = new ConsoleDiagnosticLogger();
const listeners = new Set<DiagnosticListener>();

function safeSerialize(data: Record<string, unknown>): string {
    try {
        return JSON.stringify(data);
    } catch {
        return '[unserializable-data]';
    }
}

function isDebugLoggingEnabled(): boolean {
    return process.env.CODEX_DEBUG_LOGS === '1';
}

export function setDiagnosticLogger(logger: DiagnosticLogger): void {
    activeDiagnosticLogger = logger;
}

export function resetDiagnosticLogger(): void {
    activeDiagnosticLogger = new ConsoleDiagnosticLogger();
}

export function addDiagnosticListener(listener: DiagnosticListener): void {
    listeners.add(listener);
}

export function removeDiagnosticListener(listener: DiagnosticListener): void {
    listeners.delete(listener);
}

function notifyListeners(level: DiagnosticLevel, event: DiagnosticEvent): void {
    for (const listener of listeners) {
        listener(level, event);
    }
}

export function logDebug(event: DiagnosticEvent): void {
    if (!isDebugLoggingEnabled()) {
        return;
    }
    activeDiagnosticLogger.log('debug', event);
    notifyListeners('debug', event);
}

export function logInfo(event: DiagnosticEvent): void {
    if (!isDebugLoggingEnabled()) {
        return;
    }
    activeDiagnosticLogger.log('info', event);
    notifyListeners('info', event);
}

export function logWarn(event: DiagnosticEvent): void {
    activeDiagnosticLogger.log('warn', event);
    notifyListeners('warn', event);
}

export function logError(event: DiagnosticEvent): void {
    activeDiagnosticLogger.log('error', event);
    notifyListeners('error', event);
}
