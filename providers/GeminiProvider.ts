import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseProvider, type ChatStreamParams } from './BaseProvider.js';
import type { StreamEvent, ToolCall } from '../types/index.js';
import { zodToJsonSchema } from './zodHelper.js';

export class GeminiProvider extends BaseProvider {
  readonly name = 'gemini';
  private genAI: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    super();
    this.genAI = new GoogleGenerativeAI(apiKey || process.env.GEMINI_API_KEY || '');
  }

  async *streamChat(params: ChatStreamParams): AsyncGenerator<StreamEvent, void, unknown> {
    const { model, systemPrompt, messages, tools, temperature } = params;

    // Convert tools to Google GenAI function declarations format
    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.inputSchema),
    }));

    const geminiModel = this.genAI.getGenerativeModel({
      model: model || 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
      tools: functionDeclarations.length > 0 ? [{ functionDeclarations: functionDeclarations as any }] : undefined,
      generationConfig: {
        temperature: temperature ?? 0.2,
        maxOutputTokens: params.maxTokens ?? 16384,
      },
    });

    // Convert message history to Gemini Contents with strict functionCall/functionResponse pairing
    const contents: any[] = [];
    const pendingFunctionCalls = new Map<string, string>(); // callId -> name

    for (const msg of messages) {
      if (msg.role === 'user') {
        // Defensive: If prior functionCalls were not resolved, insert synthetic failure responses
        if (pendingFunctionCalls.size > 0) {
          const autoResponses: any[] = [];
          for (const [callId, toolName] of pendingFunctionCalls.entries()) {
            autoResponses.push({
              functionResponse: {
                name: toolName,
                response: {
                  content: `[TOOL INTERRUPTED]: The tool "${toolName}" was not executed. Operation cancelled or interrupted.`,
                },
              },
            });
          }
          contents.push({ role: 'user', parts: autoResponses });
          pendingFunctionCalls.clear();
        }

        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        // Defensive: If prior functionCalls were still pending before another assistant message, close them
        if (pendingFunctionCalls.size > 0) {
          const autoResponses: any[] = [];
          for (const [callId, toolName] of pendingFunctionCalls.entries()) {
            autoResponses.push({
              functionResponse: {
                name: toolName,
                response: {
                  content: `[TOOL INTERRUPTED]: The tool "${toolName}" was not executed.`,
                },
              },
            });
          }
          contents.push({ role: 'user', parts: autoResponses });
          pendingFunctionCalls.clear();
        }

        const parts: any[] = [];
        if (msg.content) parts.push({ text: msg.content });
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            const part: any = {
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            };
            if (tc.thoughtSignature) {
              part.thoughtSignature = tc.thoughtSignature;
            }
            parts.push(part);
            pendingFunctionCalls.set(tc.id || tc.name, tc.name);
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool' && msg.toolResult) {
        const responsePart = {
          functionResponse: {
            name: msg.toolResult.toolName,
            response: { content: msg.toolResult.content },
          },
        };

        pendingFunctionCalls.delete(msg.toolResult.toolCallId);
        pendingFunctionCalls.delete(msg.toolResult.toolName);

        // Merge adjacent tool responses into a single 'user' content turn to follow Gemini API spec
        const lastContent = contents[contents.length - 1];
        if (
          lastContent &&
          lastContent.role === 'user' &&
          Array.isArray(lastContent.parts) &&
          lastContent.parts.some((p: any) => p.functionResponse)
        ) {
          lastContent.parts.push(responsePart);
        } else {
          contents.push({
            role: 'user',
            parts: [responsePart],
          });
        }
      }
    }

    // Defensive: If any functionCalls remain unfulfilled at the end of trajectory, close them
    if (pendingFunctionCalls.size > 0) {
      const autoResponses: any[] = [];
      for (const [callId, toolName] of pendingFunctionCalls.entries()) {
        autoResponses.push({
          functionResponse: {
            name: toolName,
            response: {
              content: `[TOOL INTERRUPTED]: The tool "${toolName}" was not executed.`,
            },
          },
        });
      }
      contents.push({ role: 'user', parts: autoResponses });
      pendingFunctionCalls.clear();
    }


    let result: any;
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        result = await geminiModel.generateContentStream({ contents });
        break;
      } catch (streamErr: any) {
        const errMsg = streamErr?.message || '';
        const isRateLimit = errMsg.includes('429') || errMsg.includes('Quota exceeded') || errMsg.includes('Too Many Requests');
        const isSpike = errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('Service Unavailable');
        if ((isRateLimit || isSpike) && attempt < MAX_RETRIES) {
          let waitMs = 2000 * Math.pow(2, attempt - 1);
          const match = errMsg.match(/retry in ([0-9.]+)s/);
          if (match && parseFloat(match[1])) {
            const seconds = parseFloat(match[1]);
            if (seconds <= 45) {
              waitMs = Math.ceil(seconds * 1000) + 1000;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        throw streamErr;
      }
    }

    let hasFunctionCall = false;
    let toolCallCounter = 0;

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield { type: 'text_delta', delta: text };
      }

      const candidateParts = chunk.candidates?.[0]?.content?.parts || [];
      for (const part of candidateParts) {
        const fc = (part as any).functionCall;
        if (fc) {
          hasFunctionCall = true;
          toolCallCounter++;
          const toolCall: ToolCall = {
            id: fc.id || `gemini_call_${Date.now()}_${toolCallCounter}`,
            name: fc.name,
            arguments: (fc.args as Record<string, unknown>) || {},
            thoughtSignature: (part as any).thoughtSignature,
          };
          yield { type: 'tool_call_start', id: toolCall.id, name: toolCall.name };
          yield { type: 'tool_call_done', toolCall };
        }
      }
    }

    try {
      const response = await result.response;
      if (response?.usageMetadata) {
        yield {
          type: 'usage',
          inputTokens: response.usageMetadata.promptTokenCount || 0,
          outputTokens: response.usageMetadata.candidatesTokenCount || 0,
        };
      }
    } catch {
      // Fallback in QueryEngine handles token estimation if usage metadata fails
    }

    yield { type: 'finish', reason: hasFunctionCall ? 'tool_use' : 'end_turn' };
  }
}
