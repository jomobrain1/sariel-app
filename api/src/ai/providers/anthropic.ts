import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, type AiMessage, type ChatProvider, type Part } from '../types.js';

// Anthropic Claude through the official SDK. Chat only: Anthropic offers no embeddings or image generation.
function toMessages(messages:AiMessage[], model:string): Anthropic.Beta.BetaMessageParam[] {
  return messages.map(message => {
    // Replay the provider's own content (including thinking blocks) unchanged on the same model.
    if (message.role === 'assistant' && message.native?.provider === 'anthropic' && message.native.model === model)
      return {role:'assistant', content:message.native.content as Anthropic.Beta.BetaContentBlockParam[]};
    const content = message.parts.map((part):Anthropic.Beta.BetaContentBlockParam => {
      if (part.type === 'text') return {type:'text', text:part.text};
      if (part.type === 'document') return part.mime === 'application/pdf'
        ? {type:'document', source:{type:'base64', media_type:'application/pdf', data:part.data}}
        : {type:'image', source:{type:'base64', media_type:part.mime as 'image/png', data:part.data}};
      if (part.type === 'tool_call') return {type:'tool_use', id:part.id, name:part.name, input:part.args};
      return {type:'tool_result', tool_use_id:part.id, content:JSON.stringify(part.result), ...(part.isError ? {is_error:true} : {})};
    });
    return {role:message.role, content};
  });
}

export const anthropic: ChatProvider = {
  async chat(config, request) {
    const client = new Anthropic({apiKey:config.apiKey, ...(config.baseUrl || process.env.ANTHROPIC_BASE_URL ? {baseURL:config.baseUrl || process.env.ANTHROPIC_BASE_URL} : {}), maxRetries:2});
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model:config.model,
        max_tokens:request.maxTokens ?? 16000,
        system:request.system,
        messages:toMessages(request.messages, config.model),
        ...(request.tools?.length ? {tools:request.tools.map(t => ({name:t.name, description:t.description, input_schema:t.parameters as Anthropic.Beta.BetaTool.InputSchema}))} : {}),
        // If a safety classifier declines, the API retries on a suitable fallback model within the same call.
        betas:['server-side-fallback-2026-07-01'],
        fallbacks:'default',
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw new ProviderError('Anthropic rate limit reached. Try again shortly.', 429, true);
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new ProviderError('Anthropic rejected the API key.');
      if (error instanceof Anthropic.BadRequestError) throw new ProviderError('Anthropic rejected the request: ' + error.message.slice(0, 200));
      if (error instanceof Anthropic.APIError) throw new ProviderError(`Anthropic error ${error.status ?? ''}`.trim(), 502, true);
      throw new ProviderError('Anthropic could not be reached.', 502, true);
    }
    const parts:Part[] = [];
    for (const block of response.content) {
      if (block.type === 'text') parts.push({type:'text', text:block.text});
      else if (block.type === 'tool_use') parts.push({type:'tool_call', id:block.id, name:block.name, args:(block.input ?? {}) as Record<string, unknown>});
    }
    const stop = response.stop_reason === 'tool_use' ? 'tool' : response.stop_reason === 'max_tokens' ? 'max_tokens'
      : response.stop_reason === 'refusal' ? 'refusal' : 'end';
    return {message:{role:'assistant', parts, native:{provider:'anthropic', model:config.model, content:response.content}},
      stop, usage:{input:response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0), output:response.usage.output_tokens}};
  },
};
