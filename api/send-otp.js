/**
 * /api/send-otp.js — Vercel Edge Function
 * Sends a 6-digit verification code to a phone number via Twilio Verify.
 *
 * Required Vercel env vars:
 *   TWILIO_ACCOUNT_SID        — from twilio.com/console
 *   TWILIO_AUTH_TOKEN         — from twilio.com/console
 *   TWILIO_VERIFY_SERVICE_SID — create at twilio.com/console/verify/services
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }

    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const accountSid  = process.env.TWILIO_ACCOUNT_SID;
    const authToken   = process.env.TWILIO_AUTH_TOKEN;
    const serviceSid  = process.env.TWILIO_VERIFY_SERVICE_SID;

    if (!accountSid || !authToken || !serviceSid) {
        return json({ error: 'Twilio credentials not configured' }, 500);
    }

    let phone, rawPhone;
    try {
        const body = await req.json();
        rawPhone = (body.phone || '').trim();
        phone = rawPhone.replace(/\D/g, ''); // digits only
    } catch {
        return json({ error: 'Invalid request body' }, 400);
    }

    // Normalise to E.164
    // If user included "+" they provided a country code — use as-is
    // Otherwise assume US (+1) for 10-digit numbers
    const hasCountryCode = rawPhone.startsWith('+');
    if (!hasCountryCode && phone.length === 10) phone = '1' + phone;

    if (phone.length < 10 || phone.length > 15) {
        return json({ error: 'Invalid phone number. Include your country code for international numbers (e.g. +55).' }, 400);
    }
    phone = '+' + phone;

    // Call Twilio Verify — send SMS code
    const twilioUrl = `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`;
    const credentials = btoa(`${accountSid}:${authToken}`);

    const twilioRes = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: phone, Channel: 'sms' }),
    });

    if (!twilioRes.ok) {
        const errData = await twilioRes.json().catch(() => ({}));
        const msg = errData.message || 'Failed to send verification code.';
        return json({ error: msg }, 400);
    }

    return json({ success: true, phone });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
