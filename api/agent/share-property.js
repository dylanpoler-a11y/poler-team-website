/**
 * /api/agent/share-property.js
 * Generate a personalized listing URL for a lead, optionally with a suggested
 * outreach message. Does NOT auto-send — returns URL + draft text for Kevin/agent
 * to send manually via WhatsApp/iMessage/email.
 *
 * Body: { leadId, mlsId, channel?: 'whatsapp'|'sms'|'email', message? }
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Bad body' }, 400); }
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const { leadId, mlsId, channel = 'whatsapp', message = '' } = body;
    if (!leadId || !mlsId) return json({ error: 'leadId and mlsId required' }, 400);

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const bridgeToken = process.env.BRIDGE_API_TOKEN;

    // Fetch lead
    const leadRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!leadRes.ok) return json({ error: 'Lead not found' }, 404);
    const lead = await leadRes.json();
    const email = lead.fields?.Email || '';
    const phone = (lead.fields?.Phone || '').replace(/[^+\d]/g, '');
    const firstName = lead.fields?.['First Name'] || '';
    const token = lead.fields?.['Alert Token'] || '';

    // Fetch listing
    const listingRes = await fetch(
        `https://api.bridgedataoutput.com/api/v2/miamire/listings?access_token=${bridgeToken}&ListingId=${mlsId}&fields=ListingId,ListPrice,BedroomsTotal,BathroomsTotalInteger,LivingArea,UnparsedAddress,City,Media`
    );
    if (!listingRes.ok) return json({ error: 'Bridge fetch failed' }, 502);
    const listing = (await listingRes.json()).bundle?.[0];
    if (!listing) return json({ error: 'Listing not found' }, 404);

    // Build personalized URL with auto-login token
    const url = `https://homesinsoflorida.com/listing?mls=${mlsId}&email=${encodeURIComponent(email)}${token ? `&t=${token}` : ''}`;

    // Default message if not provided
    const price = '$' + Number(listing.ListPrice || 0).toLocaleString();
    const beds  = listing.BedroomsTotal || '?';
    const baths = listing.BathroomsTotalInteger || '?';
    const sqft  = listing.LivingArea ? `${listing.LivingArea} sqft` : '';
    const addr  = listing.UnparsedAddress || listing.City || '';
    const defaultMessage = message || `${firstName ? `hey ${firstName}, ` : ''}thought you'd like this one. ${beds}bd/${baths}ba ${sqft} at ${addr.split(',')[0]}, ${price}. ${url}`;

    let shareLink = url;
    if (channel === 'whatsapp' && phone) {
        shareLink = `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(defaultMessage)}`;
    } else if (channel === 'sms' && phone) {
        shareLink = `sms:${phone}?&body=${encodeURIComponent(defaultMessage)}`;
    } else if (channel === 'email' && email) {
        const subject = `Property at ${addr.split(',')[0]} — ${price}`;
        shareLink = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(defaultMessage)}`;
    }

    return json({
        url,
        message: defaultMessage,
        shareLink,
        listing: {
            mlsId, price: listing.ListPrice, beds, baths, sqft: listing.LivingArea,
            address: addr,
            photo: (listing.Media || [])[0]?.MediaURL || null,
        },
        lead: { email, phone: lead.fields?.Phone || '', firstName },
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
