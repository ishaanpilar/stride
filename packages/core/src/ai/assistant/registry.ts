import { declineOutOfScopeTool } from './guardrails';
import { createPlanTool } from './plan-tool';
import { CORE_TOOLS } from './tools';
import { EXTRA_TOOLS } from './tools-extra';
import { AREA_TOOLS } from './tools-areas';
import type { AssistantTool, AssistantToolDefinition } from './types';

const BASE_TOOLS: AssistantTool[] = [...CORE_TOOLS, ...AREA_TOOLS, ...EXTRA_TOOLS];
const planTool = createPlanTool(() => BASE_TOOLS);

/** Every tool the Assistant can call. The decline tool is not plannable (it ends the turn). */
export const ASSISTANT_TOOLS: AssistantTool[] = [...BASE_TOOLS, planTool, declineOutOfScopeTool];

export const getToolDefinitions = (tools: AssistantTool[] = ASSISTANT_TOOLS): AssistantToolDefinition[] =>
    tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
