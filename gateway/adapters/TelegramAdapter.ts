export interface TelegramWebhookPayload {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string };
    data: string;
    message?: { message_id: number };
  };
}

export interface TelegramFormattedResponse {
  chatId: number;
  text: string;
  parseMode: 'MarkdownV2' | 'HTML';
  replyMarkup?: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
}

export class TelegramAdapter {
  /**
   * Format approval request message with interactive Proceed/Reject inline buttons
   */
  static formatApprovalRequest(
    chatId: number,
    taskId: string,
    goal: string,
    diffSummary: string
  ): TelegramFormattedResponse {
    const text = [
      `<b>InterShader Approval Request</b>`,
      `<b>Task:</b> <code>${taskId}</code>`,
      `<b>Goal:</b> ${this.escapeHtml(goal)}`,
      ``,
      `<b>Diff Preview:</b>`,
      `<pre>${this.escapeHtml(diffSummary.slice(0, 1500))}</pre>`,
      ``,
      `<b>Safe Actions (Prevent Accidental Click):</b>`,
      `• Type: <code>/confirm ${taskId}</code> to verify and execute`,
      `• Type: <code>/reject ${taskId}</code> to decline`,
      `• Or tap quick action button below:`,
    ].join('\n');

    return {
      chatId,
      text,
      parseMode: 'HTML',
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '[Proceed] Approve', callback_data: `approve:${taskId}` },
            { text: '[Reject] Reject', callback_data: `reject:${taskId}` },
          ],
        ],
      },
    };
  }

  /**
   * Parse incoming webhook update from Telegram Bot API with typed confirmation support
   */
  static parseWebhookUpdate(payload: TelegramWebhookPayload): {
    type: 'message' | 'callback_query' | 'unknown';
    chatId?: number;
    text?: string;
    action?: string;
  } {
    if (payload.callback_query) {
      const data = payload.callback_query.data;
      const chatId = payload.callback_query.message?.message_id;
      return {
        type: 'callback_query',
        chatId,
        action: data,
      };
    }

    if (payload.message && payload.message.text) {
      const trimmed = payload.message.text.trim();
      const parts = trimmed.split(/\s+/);
      const cmd = parts[0]?.toLowerCase();
      const targetId = parts[1];

      if (cmd === '/confirm' || cmd === '/approve') {
        return {
          type: 'message',
          chatId: payload.message.chat.id,
          text: trimmed,
          action: targetId ? `approve:${targetId}` : 'approve',
        };
      }

      if (cmd === '/reject' || cmd === '/deny') {
        return {
          type: 'message',
          chatId: payload.message.chat.id,
          text: trimmed,
          action: targetId ? `reject:${targetId}` : 'reject',
        };
      }

      return {
        type: 'message',
        chatId: payload.message.chat.id,
        text: trimmed,
      };
    }

    return { type: 'unknown' };
  }

  private static escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
