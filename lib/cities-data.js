/**
 * lib/cities-data.js — source of truth for the per-city SEO landing pages
 * (/<slug>, e.g. /sunny-isles-beach-condos-for-sale), rendered live by api/city.js.
 *
 * WHY (2026-09-16): /listing?city=X canonicals to bare /listing and loads its
 * results with JS, so Google has never seen a "Sunny Isles Beach" page on this
 * site. OpenSEO pulled the live page 1 for "<city> condos for sale": in the
 * condo cities (Sunny Isles, Hallandale, Aventura, Brickell, Miami Beach…) 4–6
 * of the top 10 are small local brokerages, not portals — winnable. Single-
 * family queries in Coral Gables / Coconut Grove / "Miami homes for sale" are
 * portals + luxury brands and are deliberately NOT on this list.
 *
 * Adding a city = one entry here (+ its slug in vercel.json rewrites is NOT
 * needed: the rewrite is a pattern) + `node tools/build-tower-pages.js` to
 * refresh sitemap.xml. Every text field must be written for THAT city — the
 * live MLS numbers make the page unique, the prose makes it useful. Keep facts
 * verifiable (places, roads, landmarks); prices/counts come from Bridge, never
 * from this file.
 */

export const CITIES = [
    {
        slug: 'sunny-isles-beach-condos-for-sale',
        // Curated hero: Kevin's drone clip + poster already served from the site root
        // (same assets index.html uses). Cities without heroVideo/heroImage fall back
        // to the newest waterfront MLS listing's cover photo (see lib/city-page.js).
        heroVideo: '/sunny-isles-drone-web.mp4',
        heroImage: '/hero-poster.jpg',
        name: 'Sunny Isles Beach',
        short: 'Sunny Isles',
        county: 'Miami-Dade County',
        zips: ['33160'],
        bridgeCity: 'Sunny Isles Beach',
        lat: 25.9426, lng: -80.1226,
        // Towers listed under these Bridge/precon city names show in "New construction"
        towerCities: ['Sunny Isles Beach'],
        nearby: ['hallandale-beach-condos-for-sale', 'aventura-condos-for-sale'],
        titleTail: 'Condos & Apartments for Sale',
        tagline: 'Oceanfront condos and apartments on the Collins Avenue strip, between Haulover Park and Golden Beach.',
        intro: [
            'Sunny Isles Beach is a two-mile barrier island in northeast Miami-Dade, with the Atlantic on one side of Collins Avenue and the Intracoastal Waterway on the other. Almost everything for sale here is a condo: the oceanfront side of Collins is lined with towers like Acqualina, Jade Signature, Porsche Design Tower, Armani/Casa, Turnberry Ocean Club and the Ritz-Carlton Residences, while the bay side and the streets around Sunny Isles Boulevard hold older 1960s–1980s buildings and the Winston Towers complex, where prices per square foot are a fraction of the beachfront.',
            'Buyers come to Sunny Isles for three things: direct ocean views without the Miami Beach traffic, buildings with full-service amenities, and an international neighborhood where Spanish, Portuguese, Russian and Hebrew are heard as often as English. Aventura Mall, Gulfstream Park and Haulover Park are all within ten minutes, and Fort Lauderdale and Miami airports are each about 25–30 minutes away.',
            'The Poler Team is based on Collins Avenue in Sunny Isles Beach at Optimar International Realty, so the listings below are our home market. Prices, counts and the newest listings on this page come straight from the MLS and refresh through the day.',
        ],
        neighborhoods: [
            { name: 'Oceanfront Collins Avenue', blurb: 'The east side of Collins from 15500 to 19000: newer luxury towers, direct ocean views, resort amenities, the highest prices per square foot in the city.' },
            { name: 'Bay side & Sunny Isles Blvd', blurb: 'West of Collins along the Intracoastal: 1960s–80s condos, marina and bay views, and the best value in Sunny Isles for a 1–2 bedroom.' },
            { name: 'Winston Towers', blurb: 'Seven large 1970s buildings west of Collins, popular with full-time residents and seasonal owners. Some of the lowest entry prices for a Sunny Isles address.' },
            { name: 'Golden Shores', blurb: 'The small single-family pocket on the north end near Golden Beach, one of the few places in Sunny Isles to buy a house rather than a condo.' },
        ],
        buyerNotes: [
            'Most oceanfront buildings require 30–50% down for foreign-national mortgages; we work with lenders who close without a US credit history or SSN.',
            'HOA fees on the beachfront run high because of staffing, valet and insurance. We pull the building budget and reserve study before you offer.',
            'A handful of condo-hotel buildings allow short-term rentals. If Airbnb income is part of the plan, tell us first; most buildings prohibit it.',
            'Newer towers (2015 and later) tend to carry lower special-assessment risk than the 40-year-recertification buildings on the bay side.',
        ],
        faq: [
            { q: 'What do condos in Sunny Isles Beach cost?', a: 'The live snapshot above shows the current range and median. As a rule the bay side and Winston Towers are the entry point, mid-rise oceanfront buildings from the 1990s–2000s sit in the middle, and the newest branded towers on the ocean are the top of the market.' },
            { q: 'Are there apartments for sale in Sunny Isles, or only condos?', a: 'In South Florida "apartment for sale" and "condo for sale" mean the same thing: an individually owned unit in a building. Every apartment on this page is a condominium. If you are looking to rent instead, we list Sunny Isles rentals on our main search.' },
            { q: 'Can I buy in Sunny Isles Beach as a foreign national?', a: 'Yes. Buyers from Latin America, Europe and Canada make up a large share of Sunny Isles owners. You do not need a Social Security number or US credit history; we handle the entire process remotely, including a lender who works with foreign nationals.' },
            { q: 'Which Sunny Isles buildings allow short-term rentals?', a: 'Only a few condo-hotel buildings do, and rules change. Ask us for the current list before you buy a unit for Airbnb income; most residential towers restrict rentals to 6 or 12 months minimum.' },
            { q: 'Is there new construction in Sunny Isles Beach?', a: 'Yes. Bentley Residences and the St. Regis Residences are the current preconstruction towers, and we track every release and deposit schedule on their pages linked below.' },
            { q: 'How far is Sunny Isles from the airports?', a: 'Fort Lauderdale (FLL) is about 25 minutes north on I-95 and Miami International (MIA) about 30 minutes southwest, traffic permitting.' },
        ],
    },
    {
        slug: 'hallandale-beach-condos-for-sale',
        name: 'Hallandale Beach',
        short: 'Hallandale',
        county: 'Broward County',
        zips: ['33009'],
        bridgeCity: 'Hallandale Beach',
        lat: 25.9812, lng: -80.1484,
        towerCities: ['Hallandale Beach', 'Hollywood', 'Sunny Isles Beach'],
        nearby: ['sunny-isles-beach-condos-for-sale', 'aventura-condos-for-sale'],
        titleTail: 'Condos & Homes for Sale',
        tagline: 'Beachfront condos on South Ocean Drive and waterfront homes on Golden Isles and Three Islands, one bridge north of Sunny Isles.',
        intro: [
            'Hallandale Beach is the first city in Broward County north of Sunny Isles and Golden Beach, split by the Intracoastal into an oceanfront side and a mainland side. South Ocean Drive (A1A) carries a wall of condos from the 1970s Hemispheres and Parker towers to newer buildings like Beachwalk, 2000 Ocean and Hyde Beach House, while Hallandale Beach Boulevard runs west past Gulfstream Park to I-95.',
            'What sets Hallandale apart is price: it shares the same beach and the same view corridor as Sunny Isles, but ocean-view units here typically trade well below the Sunny Isles number per square foot. The mainland side adds something Sunny Isles barely has, waterfront single-family homes on Golden Isles and Three Islands with dock access to the Intracoastal, plus the townhomes and garden condos around the Diplomat golf course.',
            'Gulfstream Park is the center of the city: the racetrack and casino sit inside a shopping and restaurant village, and the Brightline station in Aventura is a five-minute drive. Every price and count on this page is pulled live from the MLS.',
        ],
        neighborhoods: [
            { name: 'South Ocean Drive (A1A)', blurb: 'Oceanfront condo towers from Hallandale Beach Blvd south to the Sunny Isles line. Older buildings offer the cheapest direct-ocean views in the area; Beachwalk and 2000 Ocean are the newest.' },
            { name: 'Golden Isles', blurb: 'Gated waterfront single-family neighborhood on the Intracoastal side with private docks, a short walk from Gulfstream Park.' },
            { name: 'Three Islands', blurb: 'Three man-made islands of mid-rise condos and a marina between the mainland and A1A. Bay views, boat slips, and lower HOA fees than the beach.' },
            { name: 'Diplomat Golf & Hallandale West', blurb: 'Townhomes, villas and garden condos around the Diplomat course and west of Dixie Highway, the most affordable entry to a Hallandale address.' },
        ],
        buyerNotes: [
            'Many A1A buildings are past their 40-year recertification; we read the milestone inspection and reserve study before you commit.',
            'Hallandale allows short-term rentals in more buildings than Sunny Isles, including condo-hotel product at Beachwalk and Hyde Beach House. Confirm the building rules first.',
            'Golden Isles and Three Islands homes are the rare waterfront houses in this corridor; dock depth and bridge clearance matter if you keep a boat.',
            'Flood insurance is a real line item on the barrier island and the islands; we price it into every offer.',
        ],
        faq: [
            { q: 'Is Hallandale Beach cheaper than Sunny Isles Beach?', a: 'Usually yes for comparable ocean-view condos, because Hallandale has more 1970s inventory and fewer branded luxury towers. The live snapshots on both pages show the current medians side by side.' },
            { q: 'Are there apartments for sale in Hallandale Beach?', a: 'Yes. In Florida an apartment you buy is a condominium; every apartment on this page is a condo. For rentals, use our main search and switch to the rent tab.' },
            { q: 'Can I find a house, not a condo, in Hallandale?', a: 'Yes, mainly on Golden Isles and Three Islands (waterfront) and in the neighborhoods west of Dixie Highway. Houses are a small share of the market, so tell us your budget and we will watch for new listings.' },
            { q: 'Which Hallandale Beach buildings allow Airbnb or short-term rentals?', a: 'Beachwalk and Hyde Beach House were built as condo-hotels and allow short stays; a few older A1A buildings allow 30-day rentals. We keep a current list; ask before you buy for rental income.' },
            { q: 'How do I buy in Hallandale Beach from abroad?', a: 'Remotely, start to finish. We work with lenders who finance foreign nationals without a US credit history, and we handle inspections, closing and property management referrals.' },
            { q: 'What is nearby?', a: 'Gulfstream Park (racing, casino, shops, restaurants), the Aventura Brightline station, Aventura Mall, Hollywood Beach Broadwalk and the Sunny Isles beaches, all within 10 minutes.' },
        ],
    },
    {
        slug: 'aventura-condos-for-sale',
        name: 'Aventura',
        short: 'Aventura',
        county: 'Miami-Dade County',
        zips: ['33180'],
        bridgeCity: 'Aventura',
        lat: 25.9565, lng: -80.1392,
        towerCities: ['Aventura', 'Sunny Isles Beach', 'North Miami Beach'],
        nearby: ['sunny-isles-beach-condos-for-sale', 'hallandale-beach-condos-for-sale'],
        titleTail: 'Condos & Homes for Sale',
        tagline: 'Waterfront condos and gated communities around Turnberry, Williams Island and Country Club Drive, minutes from the beach and the Brightline.',
        intro: [
            'Aventura sits on the mainland side of the Intracoastal, directly across from Sunny Isles Beach, and it is built almost entirely around water and golf: the Turnberry Isle course and resort, the three-mile Country Club Drive loop, and the marinas and canals of Williams Island, Porto Vita and the Waterways. Aventura Mall anchors the south end, the Brightline station opened in late 2022 on the west side, and Founders Park and the Aventura Arts & Cultural Center serve a city of full-time residents rather than seasonal owners.',
            'Unlike the beach cities, Aventura has a real mix of housing: high-rise condos on the golf course and the Intracoastal, mid-rise and garden condos along Biscayne Boulevard and NE 183rd–207th Streets, and gated single-family and townhome communities such as Aventura Lakes and Highland Lakes on the west side. That mix is why Aventura shows up in searches for homes, apartments and condos alike, and why prices span from entry-level one-bedrooms to eight-figure penthouses.',
            'For buyers relocating from Latin America or the Northeast, Aventura is the practical choice: top-rated public and private schools, a walkable mall district, and a ten-minute drive to the Sunny Isles and Hallandale beaches. Every number on this page comes live from the MLS.',
        ],
        neighborhoods: [
            { name: 'Turnberry & Country Club Drive', blurb: 'Condos overlooking the Turnberry Isle golf course and the Country Club Drive jogging loop: Turnberry Village, Turnberry on the Green, the Peninsula towers and Turnberry Towers.' },
            { name: 'Williams Island', blurb: 'Gated island of high-rises with a marina, tennis center, spa and private clubs on the Intracoastal. One of the strongest resale markets in Aventura.' },
            { name: 'Porto Vita & Hidden Bay', blurb: 'Newer luxury towers on the north end near Hallandale, with marina slips and full-service amenities.' },
            { name: 'Aventura Lakes, Highland Lakes & the Waterways', blurb: 'Gated single-family homes and townhomes on the west side and along the canals, the part of Aventura where buyers searching "homes for sale" actually find houses.' },
        ],
        buyerNotes: [
            'Aventura has a large stock of 1980s–90s condos; check the milestone inspection status and reserve funding on anything over 30 years old.',
            'Golf-course and Intracoastal views carry a clear premium over Biscayne Boulevard views in the same building; we pull comps by line, not just by building.',
            'Short-term rentals are prohibited in nearly all Aventura condos; this is a market for owner-occupants and 12-month leases.',
            'The Brightline station and Aventura Mall employment base keep rental demand steady for investors on annual leases.',
        ],
        faq: [
            { q: 'Are there houses for sale in Aventura, or only condos?', a: 'Both. Condos are the majority, but Aventura Lakes, Highland Lakes, the Waterways and Aventura Isles are gated single-family and townhome communities. The snapshot above shows how many of each are on the market right now.' },
            { q: 'What do apartments in Aventura cost?', a: 'Apartments for sale in Florida are condominiums. The live range and median on this page update through the day; older buildings along Biscayne Boulevard are the entry point, Williams Island and Porto Vita the top.' },
            { q: 'Is Aventura a good area for families?', a: 'It is one of the most family-oriented cities in northeast Miami-Dade: Aventura Waterways K-8, the Don Soffer Aventura High School charter, Founders Park, and a large share of full-time residents rather than seasonal owners.' },
            { q: 'Can I rent out an Aventura condo on Airbnb?', a: 'Almost never. Aventura condos overwhelmingly require annual leases. If short-term income is the goal, look at the condo-hotel buildings in Hallandale Beach or Sunny Isles instead; we can point you to them.' },
            { q: 'How do I buy in Aventura from outside the US?', a: 'Remotely. No Social Security number or US credit history is needed; we work with foreign-national lenders and manage inspections, closing and property management for you.' },
            { q: 'Is there new construction in Aventura?', a: 'Yes; the current preconstruction towers in and around Aventura are listed below with prices, floor plans and deposit schedules.' },
        ],
    },
];

export const findCity = (slug) => CITIES.find(c => c.slug === String(slug || '').toLowerCase()) || null;
