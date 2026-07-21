import { z } from 'zod';

/**
 * A2A (Agent-to-Agent) protocol v1.0 wire contracts — isomorphic. Mirrors the
 * JSON-RPC method/task/message/artifact/agent-card shapes from the A2A spec.
 * No engine mirror: this is the first introduction of these shapes on the
 * wire (Slice 31 Task 1), so there is no parity test against `src/`.
 */

/** JSON-RPC task lifecycle state — lowercase-hyphenated, the A2A wire casing. */
export enum TaskStateWire {
  Submitted = 'submitted',
  Working = 'working',
  Completed = 'completed',
  Failed = 'failed',
  Canceled = 'canceled',
  Rejected = 'rejected',
  InputRequired = 'input-required',
  AuthRequired = 'auth-required',
}

/** A2A JSON-RPC method names. */
export enum A2aMethod {
  MessageSend = 'message/send',
  MessageStream = 'message/stream',
  TasksGet = 'tasks/get',
  TasksCancel = 'tasks/cancel',
  TasksResubscribe = 'tasks/resubscribe',
}

export const PartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({
    kind: z.literal('file'),
    file: z.object({
      name: z.string().optional(),
      mimeType: z.string().optional(),
      bytes: z.string(),
    }),
  }),
  z.object({
    kind: z.literal('data'),
    data: z.record(z.string(), z.unknown()),
  }),
]);
export type A2aPart = z.infer<typeof PartSchema>;

export const MessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  parts: z.array(PartSchema),
  messageId: z.string(),
  contextId: z.string().optional(),
  taskId: z.string().optional(),
});
export type A2aMessage = z.infer<typeof MessageSchema>;

export const ArtifactSchema = z.object({
  artifactId: z.string(),
  name: z.string().optional(),
  parts: z.array(PartSchema),
});
export type A2aArtifact = z.infer<typeof ArtifactSchema>;

export const TaskStatusSchema = z.object({
  state: z.enum(TaskStateWire),
  message: MessageSchema.optional(),
  timestamp: z.string().optional(),
});
export type A2aTaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  contextId: z.string(),
  status: TaskStatusSchema,
  artifacts: z.array(ArtifactSchema).default([]),
  history: z.array(MessageSchema).default([]),
  kind: z.literal('task'),
});
export type A2aTask = z.infer<typeof TaskSchema>;

export const AgentSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  inputModes: z.array(z.string()).optional(),
  outputModes: z.array(z.string()).optional(),
});
export type A2aAgentSkill = z.infer<typeof AgentSkillSchema>;

export const AgentCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  protocolVersion: z.literal('1.0'),
  url: z.string(),
  preferredTransport: z.string().default('JSONRPC'),
  skills: z.array(AgentSkillSchema),
  capabilities: z.object({
    streaming: z.boolean(),
    pushNotifications: z.boolean(),
  }),
  defaultInputModes: z.array(z.string()),
  defaultOutputModes: z.array(z.string()),
  securitySchemes: z.record(z.string(), z.unknown()),
  security: z.array(z.record(z.string(), z.array(z.string()))).default([]),
});
export type A2aAgentCard = z.infer<typeof AgentCardSchema>;

export const JsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).nullable(),
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).nullable(),
  result: z.unknown().optional(),
  error: JsonRpcErrorSchema.optional(),
});
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;
