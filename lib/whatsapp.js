/**
 * lib/whatsapp.js — send WhatsApp messages via Twilio's Messaging API.
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM  — e.g. "whatsapp:+14155238886" (Twilio sandbox)
 *                          or a WhatsApp-enabled number you own
 *
 * Per-owner recipient env vars (any subset):
 *   NOTIFY_WHATSAPP_KEVIN, NOTIFY_WHATSAPP_NOEL, NOTIFY_WHATSAPP_DYLAN, NOTIFY_WHATSAPP_ROSA
 *   Each one is a phone in E.164, e.g. "+13057997290".
 *
 * Sandbox prerequisites:
 *   Recipient must first send "join <sandbox-code>" via WhatsApp to
 *   +1 415 523 8886 (Twilio's sandbox number). The code is shown in the
 *   Twilio console under Messaging → Try It Out → WhatsApp Sandbox.
 *
 * Production: same code path; just set TWILIO_WHATSAPP_FROM to your
 * approved WhatsApp Business sender.
 */

const TWILIO_API = (sid) => `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;

/**
 * Returns the WhatsApp E.164 number for a given owner name, or null if not configured.
 */
export function getOwnerWhatsApp(owner) {
    const key = `NOTIFY_WHATSAPP_${(owner || '').toUpperCase()}`;
    const num = (process.env[key] || '').trim();
    return num || null;
}

/**
 * Send a single WhatsApp message. Returns true on success, false on failure.
 * NEVER throws — meant to be best-effort from the cron.
 */
export async function sendWhatsAppMessage({ to, body }) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;

    if (!sid || !token || !from) {
        console.warn('[whatsapp] not configured (missing TWILIO_ACCOUNT_SID / AUTH_TOKEN / TWILIO_WHATSAPP_FROM)');
        return false;
    }
    if (!to || !body) return false;

    // Normalize: ensure recipient has whatsapp: prefix
    const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const fromFormatted = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;

    const params = new URLSearchParams({
        From: fromFormatted,
        To: toFormatted,
        Body: body.slice(0, 1500), // WhatsApp limit ~1600 chars
    });

    try {
        const res = await fetch(TWILIO_API(sid), {
            method: 'POST',
            headers: {
                Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params,
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.error(`[whatsapp] Twilio ${res.status}: ${txt.slice(0, 300)}`);
            return false;
        }
        return true;
    } catch (err) {
        console.error('[whatsapp] send failed:', err.message);
        return false;
    }
}
