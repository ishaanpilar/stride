import type { Area, Project, Task } from '../../types';

/** OpenAI-style chat message (the harness's internal wire format). */
export interface AssistantToolCall {
    id: string;
    name: string;
    /** Raw JSON string exactly as the model produced it. */
    arguments: string;
}

export interface AssistantMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    toolCalls?: AssistantToolCall[];
    toolCallId?: string;
    /** DeepSeek thinking mode requires echoing this back within the same turn. */
    reasoningContent?: string;
    /**
     * Anthropic only: the assistant's raw content blocks (thinking, redacted_thinking, text, tool_use)
     * exactly as returned. Replayed unchanged within the same turn, because Claude validates thinking
     * blocks against the unmodified conversation. Never persisted across turns.
     */
    providerBlocks?: unknown[];
}

export interface AssistantToolDefinition {
    name: string;
    description: string;
    parameters: JsonSchema;
}

export interface AssistantModelRequest {
    messages: AssistantMessage[];
    tools: AssistantToolDefinition[];
    signal?: AbortSignal;
}

export interface AssistantModelResponse {
    message: AssistantMessage;
    finishReason?: string;
}

/** Model backend behind the loop: OpenAI-compatible (OpenAI, DeepSeek, custom) or Anthropic. */
export interface AssistantModelClient {
    complete(request: AssistantModelRequest): Promise<AssistantModelResponse>;
}

export interface JsonSchema {
    type?: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'null';
    description?: string;
    enum?: readonly (string | number)[];
    properties?: Record<string, JsonSchema>;
    required?: readonly string[];
    items?: JsonSchema;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    /** Value may also be null (used to clear a field). */
    nullable?: boolean;
    additionalProperties?: boolean;
}

export interface StoreResult {
    success: boolean;
    error?: string;
    id?: string;
}

/**
 * The only way tools touch app state. The desktop adapter forwards to the shared
 * Zustand store actions, so sync/undo/UI stay consistent. Tests use an in-memory fake.
 */
export interface AssistantStorePort {
    getSnapshot(): { tasks: Task[]; projects: Project[]; areas: Area[] };
    addTask(title: string, props: Partial<Task>): Promise<StoreResult>;
    updateTask(id: string, updates: Partial<Task>): Promise<StoreResult>;
    completeTask(id: string): Promise<StoreResult>;
    deleteTask(id: string): Promise<StoreResult>;
    restoreTask(id: string): Promise<StoreResult>;
    addProject(title: string, color: string, props: Partial<Project>): Promise<Project | null>;
    deleteProject(id: string): Promise<StoreResult>;
    restoreProject(id: string): Promise<StoreResult>;
}

export type UndoOp =
    | { kind: 'restoreFields'; taskId: string; fields: Partial<Task>; clear: string[] }
    | { kind: 'deleteTask'; taskId: string }
    | { kind: 'restoreTask'; taskId: string }
    | { kind: 'deleteProject'; projectId: string }
    | { kind: 'restoreProject'; projectId: string };

export interface FieldChange {
    taskId: string;
    title: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
}

export interface ChangeEntry {
    id: string;
    /** Id of the user message (turn) that caused it. */
    messageId: string;
    toolName: string;
    /** Chip text, e.g. "Added 'Dentist' · Fri 6 Nov, 17:00". */
    label: string;
    at: string;
    undone: boolean;
    undoOps: UndoOp[];
    changes: FieldChange[];
}

export interface PendingConfirmation {
    id: string;
    messageId: string;
    toolName: string;
    args: Record<string, unknown>;
    reason: string;
    summary: string;
    affected: Array<{ id: string; title: string }>;
    status: 'pending' | 'confirmed' | 'rejected';
    createdAt: string;
}

/** What a tool returns: `data` goes back to the model, the rest drives the UI. */
export interface ToolOutcome {
    ok: boolean;
    data?: unknown;
    error?: string;
    change?: Omit<ChangeEntry, 'id' | 'messageId' | 'at' | 'undone' | 'toolName'>;
}

export interface ToolContext {
    port: AssistantStorePort;
    now: Date;
    timeZone?: string;
}

export interface ConfirmationRequest {
    reason: string;
    summary: string;
    affectedTaskIds: string[];
}

export interface AssistantTool {
    name: string;
    description: string;
    parameters: JsonSchema;
    mutating: boolean;
    /** Semantic validation after schema validation; returns an error string for the model. */
    validate?: (args: Record<string, any>, ctx: ToolContext) => string | null;
    /** Return a request to gate execution behind explicit user confirmation. */
    confirmation?: (args: Record<string, any>, ctx: ToolContext) => ConfirmationRequest | null;
    execute: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolOutcome>;
}
