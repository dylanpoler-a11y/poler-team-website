/**
 * /api/verify-otp.js — Vercel Edge Function
 * Checks the 6-digit code the user typed against Twilio Verify.
 *
 * Required Vercel env vars (same as send-otp):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_VERIFY_SERVICE_SID
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

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

    if (!accountSid || !authToken || !serviceSid) {
        return json({ error: 'Twilio credentials not configured' }, 500);
    }

    let phone, code;
    try {
        const body = await req.json();
        code  = (body.code  || '').replace(/\D/g, '').substring(0, 6);
        phone = (body.phone || '').replace(/\D/g, '');
    } catch {
        return json({ error: 'Invalid request body' }, 400);
    }

    if (!code || code.length !== 6) {
        return json({ error: 'Please enter the 6-digit code.' }, 400);
    }

    // Normalise phone to E.164
    if (phone.length === 10) phone = '1' + phone;
    phone = '+' + phone;

    // Call Twilio Verify — check the code
    const twilioUrl = `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`;
    const credentials = btoa(`${accountSid}:${authToken}`);

    const twilioRes = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: phone, Code: code }),
    });

    const data = await twilioRes.json().catch(() => ({}));

    if (!twilioRes.ok) {
        const msg = data.message || data.error || `Twilio error ${twilioRes.status}`;
        return json({ error: 'Incorrect code. Please try again.' }, 400);
    }

    if (data.status !== 'approved') {
        return json({ error: 'Incorrect code. Please try again.' }, 400);
    }

    return json({ verified: true });
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
