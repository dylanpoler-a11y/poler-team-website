/**
 * lib/telegram.js — send messages via the Telegram Bot API.
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather (looks like "123456789:ABCdef...")
 *
 * Per-owner recipient env vars:
 *   TELEGRAM_CHAT_ID_KEVIN, TELEGRAM_CHAT_ID_NOEL,
 *   TELEGRAM_CHAT_ID_DYLAN, TELEGRAM_CHAT_ID_ROSA
 *   Each is a numeric chat_id, obtained once by visiting:
 *     https://api.telegram.org/bot<TOKEN>/getUpdates
 *   after the user has sent any message to the bot.
 *
 * Production-ready out of the box — no purchases, no 72-hr expiry,
 * no Facebook approval. Telegram Bot API is free + unlimited.
 */

const TELEGRAM_API = (token) => `https://api.telegram.org/bot${token}`;

/**
 * Returns the Telegram chat_id for a given owner name, or null if not configured.
 */
export function getOwnerChatId(owner) {
    const key = `TELEGRAM_CHAT_ID_${(owner || '').toUpperCase()}`;
    const id = (process.env[key] || '').trim();
    return id || null;
}

/**
 * Send a single Telegram message. Returns true on success, false on failure.
 * NEVER throws — meant to be best-effort from the cron.
 *
 * @param {object} args
 * @param {string} args.chatId      — numeric chat_id (or @channelname)
 * @param {string} args.text        — message body (4096 char Telegram limit)
 * @param {boolean} [args.markdown] — set true to parse Telegram MarkdownV2
 */
export async function sendTelegramMessage({ chatId, text, markdown = false }) {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
        console.warn('[telegram] TELEGRAM_BOT_TOKEN not set');
        return false;
    }
    if (!chatId || !text) return false;

    const body = {
        chat_id: chatId,
        text: text.slice(0, 4096),
        disable_web_page_preview: true,
    };
    if (markdown) body.parse_mode = 'MarkdownV2';

    try {
        const res = await fetch(`${TELEGRAM_API(token)}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.error(`[telegram] ${res.status}: ${txt.slice(0, 300)}`);
            return false;
        }
        return true;
    } catch (err) {
        console.error('[telegram] send failed:', err.message);
        return false;
    }
}
