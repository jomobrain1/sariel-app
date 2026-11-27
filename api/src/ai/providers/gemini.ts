import { ProviderError, type AiMessage, type ChatProvider, type ChatRequest, type EmbeddingProvider, type ImageProvider, type Part, type ProviderConfig } from '../types.js';

// Google Gemini over its REST API (generativelanguage.googleapis.com).
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiPart = {text?:string; thought?:boolean; functionCall?:{id?:string; name:string; args?:Record<string, unknown>};
  functionResponse?:{id?:string; name:string; response:Record<string, unknown>}; inlineData?:{mimeType:string; data:string}; [key:string]:unknown};
type GeminiContent = {role:'user'|'model'; parts:GeminiPart[]};

async function call(config:ProviderConfig, path:string, body:unknown) {
  const base = (config.baseUrl || process.env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}/${path}`, {method:'POST', signal:AbortSignal.timeout(120_000), redirect:'error',
      headers:{'Content-Type':'application/json', 'x-goog-api-key':config.apiKey}, body:JSON.stringify(body)});
  } catch (error) {
    throw new ProviderError('Gemini could not be reached: ' + (error instanceof Error ? error.message : 'network error'), 502, true);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    try { detail = (JSON.parse(text) as {error?:{message?:string}}).error?.message ?? ''; } catch { /* Not JSON. */ }
    throw new ProviderError(`Gemini responded ${response.status}${detail ? ': ' + detail.slice(0, 200) : ''}`,
      response.status === 401 || response.status === 403 ? 502 : response.status === 429 ? 429 : 502, response.status === 429 || response.status >= 500);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

// Gemini accepts an OpenAPI subset of JSON Schema; drop keywords it rejects.
function schema(value:unknown): unknown {
  if (Array.isArray(value)) return value.map(schema);
  if (!value || typeof value !== 'object') return value;
  const out:Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (['$schema', 'additionalProperties', '$id', '$ref', 'definitions', '$defs', 'default', 'pattern', 'format'].includes(key)) continue;
    out[key] = schema(inner);
  }
  return out;
}

function toContents(messages:AiMessage[], model:string): GeminiContent[] {
  return messages.map(message => {
    if (message.role === 'assistant' && message.native?.provider === 'gemini' && message.native.model === model)
      return message.native.content as GeminiContent;
    const parts:GeminiPart[] = message.parts.map((part):GeminiPart => {
      if (part.type === 'text') return {text:part.text};
      if (part.type === 'document') return {inlineData:{mimeType:part.mime, data:part.data}};
      if (part.type === 'tool_call') return {functionCall:{id:part.id, name:part.name, args:part.args}};
      return {functionResponse:{id:part.id, name:part.name, response:{[part.isError ? 'error' : 'result']:part.result}}};
    });
    return {role:message.role === 'assistant' ? 'model' : 'user', parts};
  });
}

function usageOf(body:Record<string, unknown>) {
  const meta = (body.usageMetadata ?? {}) as {promptTokenCount?:number; candidatesTokenCount?:number; thoughtsTokenCount?:number};
  return {input:meta.promptTokenCount ?? 0, output:(meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0)};
}

export const gemini: ChatProvider & EmbeddingProvider & ImageProvider = {
  async chat(config, request:ChatRequest) {
    const body = await call(config, `models/${encodeURIComponent(config.model)}:generateContent`, {
      systemInstruction:{parts:[{text:request.system}]},
      contents:toContents(request.messages, config.model),
      ...(request.tools?.length ? {tools:[{functionDeclarations:request.tools.map(t => ({name:t.name, description:t.description, parameters:schema(t.parameters)}))}]} : {}),
      generationConfig:{maxOutputTokens:request.maxTokens ?? 8192},
    });
    const feedback = body.promptFeedback as {blockReason?:string} | undefined;
    const candidate = (body.candidates as {content?:GeminiContent; finishReason?:string}[] | undefined)?.[0];
    if (!candidate?.content) return {message:{role:'assistant', parts:[]}, stop:feedback?.blockReason ? 'blocked' : 'error', usage:usageOf(body)};
    const parts:Part[] = [];
    let n = 0;
    for (const part of candidate.content.parts ?? []) {
      if (part.functionCall) parts.push({type:'tool_call', id:part.functionCall.id ?? `call_${Date.now()}_${n++}`, name:part.functionCall.name, args:part.functionCall.args ?? {}});
      else if (typeof part.text === 'string' && !part.thought) parts.push({type:'text', text:part.text});
    }
    const reason = candidate.finishReason ?? 'STOP';
    const stop = parts.some(p => p.type === 'tool_call') ? 'tool'
      : reason === 'MAX_TOKENS' ? 'max_tokens'
      : ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(reason) ? 'blocked' : 'end';
    return {message:{role:'assistant', parts, native:{provider:'gemini', model:config.model, content:{role:'model', parts:candidate.content.parts ?? []}}},
      stop, usage:usageOf(body)};
  },

  async embed(config, texts, purpose) {
    const body = await call(config, `models/${encodeURIComponent(config.model)}:batchEmbedContents`, {
      requests:texts.map(text => ({model:`models/${config.model}`, content:{parts:[{text}]},
        taskType:purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT'})),
    });
    const vectors = ((body.embeddings ?? []) as {values:number[]}[]).map(e => e.values);
    if (vectors.length !== texts.length) throw new ProviderError('Gemini returned an unexpected number of embeddings.');
    // The batch endpoint does not report token counts; estimate ~4 characters per token for monitoring.
    return {vectors, usage:{input:Math.ceil(texts.join('').length / 4), output:0}};
  },

  async image(config, prompt) {
    const body = await call(config, `models/${encodeURIComponent(config.model)}:generateContent`, {
      contents:[{role:'user', parts:[{text:prompt}]}],
      generationConfig:{responseModalities:['IMAGE', 'TEXT']},
    });
    const parts = ((body.candidates as {content?:GeminiContent}[] | undefined)?.[0]?.content?.parts ?? []);
    const image = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'))?.inlineData;
    if (!image) throw new ProviderError('Gemini did not return an image. Try another theme or model.');
    return {mime:image.mimeType, data:Buffer.from(image.data, 'base64'), usage:usageOf(body)};
  },
};
