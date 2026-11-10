import type { Area, Person, Project, Task } from '../../types';
import type { RoutingCorrection } from '../routing-corrections';
import type { ProjectOrderProposal } from '../project-order-ai';

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
    /** `people` is optional so older adapters keep working; routing then ignores linked People. */
    getSnapshot(): { tasks: Task[]; projects: Project[]; areas: Area[]; people?: Person[] };
    addTask(title: string, props: Partial<Task>): Promise<StoreResult>;
    updateTask(id: string, updates: Partial<Task>): Promise<StoreResult>;
    completeTask(id: string): Promise<StoreResult>;
    deleteTask(id: string): Promise<StoreResult>;
    restoreTask(id: string): Promise<StoreResult>;
    addProject(title: string, color: string, props: Partial<Project>): Promise<Project | null>;
    deleteProject(id: string): Promise<StoreResult>;
    restoreProject(id: string): Promise<StoreResult>;
    updateProject(id: string, updates: Partial<Project>): Promise<StoreResult>;
    addArea(name: string, props: Partial<Area>): Promise<Area | null>;
    updateArea(id: string, updates: Partial<Area>): Promise<StoreResult>;
    deleteArea(id: string): Promise<StoreResult>;
    restoreArea(id: string): Promise<StoreResult>;
    /** Optional: create a Person (used when the user confirms adding people to an area). */
    addPerson?(name: string): Promise<Person | null>;
    deletePerson?(id: string): Promise<StoreResult>;
    /** Optional: the local routing-correction log (unsynced), summarized into the routing context. */
    getRoutingCorrections?(): RoutingCorrection[];
    /** Moves the project's tasks into this order (ids it does not know are ignored). */
    reorderProjectTasks(projectId: string, orderedIds: string[]): Promise<void>;
    /** Optional: one AI call proposing an order for a project (null when AI is off, limited or failed). */
    generateProjectOrder?(projectId: string): Promise<ProjectOrderProposal | null>;
}

export type UndoOp =
    | { kind: 'restoreFields'; taskId: string; fields: Partial<Task>; clear: string[] }
    | { kind: 'deleteTask'; taskId: string }
    | { kind: 'restoreTask'; taskId: string }
    | { kind: 'deleteProject'; projectId: string }
    | { kind: 'restoreProject'; projectId: string }
    | { kind: 'restoreProjectFields'; projectId: string; fields: Partial<Project>; clear: string[] }
    | { kind: 'deleteArea'; areaId: string }
    | { kind: 'restoreArea'; areaId: string }
    | { kind: 'restoreAreaFields'; areaId: string; fields: Partial<Area>; clear: string[] }
    | { kind: 'deletePerson'; personId: string };

/** What kind of thing a change touched; drives the icon in the Changes card. */
export type ChangeKind = 'task' | 'project' | 'area' | 'tag' | 'merge' | 'plan';

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
    /** Kind of entity changed (UI icon). Defaults to 'task'. */
    kind?: ChangeKind;
    /** Optional sub-lines (e.g. the steps of a batch plan). */
    details?: string[];
    /** Why the AI routed something where it did, e.g. "mentions Akash → Mauvi Labs" (validated, short). */
    reason?: string;
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
    /**
     * Runs before the confirmation gate (never when the user has already confirmed): swaps in enriched
     * arguments the confirmation card and execution will use, or ends the call with `outcome`.
     */
    prepare?: (args: Record<string, any>, ctx: ToolContext) => Promise<{ args: Record<string, any> } | { outcome: ToolOutcome }>;
    /** Return a request to gate execution behind explicit user confirmation. */
    confirmation?: (args: Record<string, any>, ctx: ToolContext) => ConfirmationRequest | null;
    execute: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolOutcome>;
}
