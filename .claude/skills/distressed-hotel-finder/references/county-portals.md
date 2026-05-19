# County Portal Reference Guide

## Table of Contents
1. [Miami-Dade County](#miami-dade-county)
2. [Broward County](#broward-county)
3. [PropertyShark](#propertyshark)
4. [Crexi Navigation](#crexi-navigation)

---

## Miami-Dade County

### Property Appraiser (Owner Info, Values, Sales History)
- **URL:** `https://apps.miamidadepa.gov/PropertySearch/`
- **Search by:** Address, owner name, or folio number
- **Returns:** Folio number, owner name/address, assessed value, market value, taxable value, ownership history, sales records, exemptions
- **Tips:** Use folio number from here for all other Miami-Dade searches

### Tax Collector (Tax Delinquency)
- **Main:** `https://mdctaxcollector.gov`
- **Delinquent taxes:** `https://mdctaxcollector.gov/delinquent-taxes-current-year-and-prior-years`
- **Search by:** Folio number
- **Key dates:** Taxes become delinquent April 1; tax certificates sold June 1

### Code Violations
- **Interactive map:** `https://gisweb.miamidade.gov/CodeViolations/` — best for visual scanning of an area
- **Case search:** `https://www.miamidade.gov/Apps/RER/RegulationSupportWebViewer/` — search by address or case number
- **Clerk citations:** `https://www2.miamidadeclerk.gov/cef/`
- **Open data (bulk download):** `https://gis-mdc.opendata.arcgis.com/maps/MDC::code-compliance-violation/explore`
- **Note:** This covers unincorporated Miami-Dade. Cities like Miami Beach, Hialeah, etc. may have separate portals.

### Lis Pendens & Foreclosure
- **Mortgage foreclosure search:** `https://www2.miami-dadeclerk.com/mfs/MortgageForeclosureSearch.aspx` — search by date range, browse lis pendens images by date
- **Foreclosure registry:** `https://bldgappl.miamidade.gov/foreclosureregistry/` — lenders must register within 10 days of filing lis pendens
- **How to search:** Look up owner via Property Appraiser, then search Clerk's recorded docs by owner name with document type "LIS"
- **Clerk info:** `https://www.miamidadeclerk.gov/clerk/mortgage-foreclosures.page`

### Probate Filings (Owner Death)
- **Case search:** `https://www2.miamidadeclerk.gov/ocs/` — free registration required
- **How to search:** Select "Probate" as case type, search by party name (owner's name)
- **Info page:** `https://www.miamidadeclerk.gov/clerk/probate-court.page`
- **Note:** Advanced access to probate documents requires free registered account

### Divorce Filings
- **Case search:** `https://www2.miamidadeclerk.gov/ocs/` — same portal as probate
- **How to search:** Select "Family" as case type, search by party name (owner's name)
- **Limitation:** Some post-2002 documents restricted from online viewing

---

## Broward County

### Property Appraiser (Owner Info, Values, Sales History)
- **Main:** `https://bcpa.net/`
- **Search page:** `https://bcpa.net/RecMenu.asp`
- **Client portal:** `https://web.bcpa.net/BcpaClient/`
- **Search by:** Owner name, address, or folio number
- **Returns:** Same as Miami-Dade — ownership, assessed/market/taxable values, sales history, exemptions

### Tax Collector (Tax Delinquency)
- **Main:** `https://browardtax.org/`
- **Search:** `https://county-taxes.net/broward` — search by account number, name, or address
- **Delinquent lists:** `https://browardcountylegalnotices.com/166/Delinquent-Real-Estate-and-Tangible-Taxe`
- **Key detail:** After 2 years delinquent, certificate holder can file Tax Deed Application

### Code Violations
- **Enforcement search:** `https://dpepp.broward.org/BCS/Default.aspx?PossePresentation=SearchForEnforcement` — no account needed
- **Building property research:** `https://www.broward.org/Building/Pages/Property-Research-.aspx` — requires account + fee
- **Info:** `https://www.broward.org/Planning/CodeEnforcement/Pages/Violations.aspx`
- **Note:** Many Broward municipalities (Hollywood, Fort Lauderdale, Pembroke Pines) have separate code violation portals

### Lis Pendens & Foreclosure
- **Official records search:** `https://officialrecords.broward.org/AcclaimWeb` — recorded documents from 1978+, filter by "Lis Pendens"
- **Case search:** `https://www.browardclerk.org/web2` — search foreclosure cases by party name or case number
- **Foreclosure auctions:** `https://www.broward.realforeclose.com` — properties listed by sale date
- **Records info:** `https://www.broward.org/RecordsTaxesTreasury/Records/pages/publicrecordssearch.aspx`

### Probate Filings (Owner Death)
- **Case search:** `https://www.browardclerk.org/Web2/` — select "Probate" under court type
- **Info:** `https://www.browardclerk.org/Divisions/ProbateAndGuardianship`
- **Note:** Viewing documents requires registered eServices account (subscription)

### Divorce Filings
- **Case search:** `https://www.browardclerk.org/Web2/` — select "Family" under court type
- **Same limitation as Miami-Dade for document access**

---

## PropertyShark

- **Main:** `https://www.propertyshark.com/mason/`
- **Miami-Dade search:** `https://www.propertyshark.com/mason/fl/Miami-Dade-County/Property-Search`
- **What it provides:** Ownership info, assessed/market values, sales history, liens, mortgages, permits, zoning, comparable sales
- **People Search:** Available on Platinum plans ($50/month add-on) — returns phone, email, social profiles for skip tracing
- **Limitations:** Does NOT directly show divorce or death records. Shows deed transfers that may indicate estate sales.
- **No API available** — must use Chrome browser tools

---

## Crexi Navigation

Crexi does not have a public search API. Use Chrome browser tools with the user's logged-in session.

### Search URL Patterns
- Hotels: `https://www.crexi.com/properties/Hotels?mapCenter=[lat],[lng]&mapZoom=[zoom]`
- Motels: `https://www.crexi.com/properties/Motels?mapCenter=[lat],[lng]&mapZoom=[zoom]`
- Hospitality (all): `https://www.crexi.com/properties/Hospitality?mapCenter=[lat],[lng]&mapZoom=[zoom]`

### Geographic Centers
- Miami-Dade: `25.7617,-80.1918` (zoom 10)
- Broward: `26.1224,-80.1373` (zoom 10)
- Both counties: `25.9,-80.15` (zoom 9)

### Additional URL Parameters
- `types[]=Hospitality`
- `subtypes[]=Hotel`
- `subtypes[]=Motel`

### What to Capture Per Listing
Property name, address, asking price, price/key, days on market, price reductions, cap rate, NOI, room count, year built, broker info, description keywords
