// Provider-neutral shapes. Each adapter converts these to and from its provider's API.

export type Part =
  | {type:'text'; text:string}
  | {type:'tool_call'; id:string; name:string; args:Record<string, unknown>}
  | {type:'tool_result'; id:string; name:string; result:unknown; isError?:boolean}
  | {type:'document'; mime:string; data:string /* base64 */};

export interface AiMessage {
  role:'user'|'assistant';
  parts:Part[];
  /** The provider's own content for this turn, replayed unchanged to the same provider (keeps reasoning signatures valid). */
  native?:{provider:string; model:string; content:unknown};
}

export interface ToolSpec { name:string; description:string; parameters:Record<string, unknown> /* JSON Schema */ }

export interface ChatRequest {
  system:string;
  messages:AiMessage[];
  tools?:ToolSpec[];
  maxTokens?:number;
}

export type StopReason = 'end' | 'tool' | 'max_tokens' | 'refusal' | 'blocked' | 'error';
export interface ChatResult {
  message:AiMessage;
  stop:StopReason;
  usage:{input:number; output:number};
}

export interface ProviderConfig { apiKey:string; model:string; baseUrl?:string }

export interface ChatProvider { chat(config:ProviderConfig, request:ChatRequest): Promise<ChatResult> }
export interface EmbeddingProvider {
  embed(config:ProviderConfig, texts:string[], purpose:'document'|'query'): Promise<{vectors:number[][]; usage:{input:number; output:number}}>;
}
export interface ImageProvider {
  image(config:ProviderConfig, prompt:string): Promise<{mime:string; data:Buffer; usage:{input:number; output:number}}>;
}

export class ProviderError extends Error {
  constructor(message:string, readonly status = 502, readonly retryable = false) { super(message); }
}
