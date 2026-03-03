# The Poler Team Website

> **Live:** [homesinsoflorida.com](https://homesinsoflorida.com)
> **Repo:** [dylanpoler-a11y/poler-team-website](https://github.com/dylanpoler-a11y/poler-team-website)
> **Deployed via:** Vercel (auto-deploy from `main`)

## Architecture

Static HTML/CSS/JS website — no build step, no framework. Vercel serves the files directly.

### File Structure

```
/
├── index.html          # Single-page site (all sections)
├── styles.css          # All styles (~71KB, CSS custom properties)
├── script.js           # All JS (~73KB, vanilla, no dependencies)
├── CLAUDE.md           # This file — project context for Claude Code
├── .gitignore          # Excludes large videos, macOS files
├── scripts/
│   └── kevin-setup.sh  # Auto-sync setup for collaborators
│
├── # Images
├── logo.png            # Dark logo (scrolled nav)
├── logo-white.png      # White logo (hero, nav default)
├── logo-variants.png   # Logo variations reference
├── pt-circle.png       # Circle logo (PWA icon)
├── optimar-logo.jpg    # Brokerage logo (Optimar International)
├── footer-logos.png    # Footer partner logos
├── team-rosa.jpg       # Rosa Poler headshot
├── team-kevin.jpg      # Kevin Poler headshot
├── team-dylan.jpg      # Dylan Poler headshot
├── ig-post-[1-8].jpg   # Instagram feed images
├── favicon.ico / favicon-192.png / favicon-512.png / apple-touch-icon.png
│
├── # Videos (tracked in git, <15MB each)
├── hero-video.mp4      # Hero background (13MB)
├── aerial-compressed.mp4
├── beach-aerial.mp4 / beach-hero.mp4
├── miami-hero.mp4 / miami-hero2.mp4 / miami-clouds.mp4 / miami-sunset.mp4
├── hero-balcony.mp4 / ocean-waves.mp4 / invest-video.mp4
│
└── # Videos (gitignored — too large)
    ├── sunny-isles-drone.mp4  (585MB — referenced in hero <video>)
    ├── testbg1.mp4            (243MB)
    └── hero-balcony.mov       (11MB)
```

**Note:** `sunny-isles-drone.mp4` is the hero background video. It must exist locally for the hero to display. It's gitignored due to size — share via AirDrop/Drive.

## Design System

| Token | Value |
|-------|-------|
| Navy (primary) | `#1a2744` — `var(--color-navy)` / `var(--color-accent)` |
| Navy light | `#243656` — `var(--color-accent-light)` |
| Navy dark | `#111c33` — `var(--color-accent-dark)` |
| Background | `#f8f9fb` — `var(--color-bg)` |
| Card bg | `#ffffff` — `var(--color-bg-card)` |
| Text primary | `#1a2744` — `var(--color-text)` |
| Text muted | `#718096` — `var(--color-text-muted)` |
| Heading font | `Playfair Display` — `var(--font-heading)` |
| Body font | `Inter` — `var(--font-body)` |

There is NO gold (#C9A84C) used in this version — the palette is navy + white + light blue/grey.

## Page Sections (in order)

1. **Preloader** — Animated "POLER" letter reveal
2. **Navigation** — Fixed top, white → scrolled (white bg + dark logo at 80px)
3. **Hero** — Fullscreen video bg, search bar (Buy/Rent/Sell tabs + AI Invest tab), language switcher
4. **Featured Listings** — Grid with placeholder cards (MLS integration coming)
5. **Meet the Team** — Rosa (featured/center), Kevin & Dylan (sides)
6. **Featured Profiles** — Homes.com + Zillow cards with stats
7. **Instagram Feed** — 8-image grid linking to real posts
8. **Marquee** — Scrolling location names
9. **Expertise** — 4 service cards (dark section)
10. **Areas** — Sunny Isles, Aventura, North Miami Beach (alternating layout)
11. **About** — Company story with parallax images
12. **Parallax Divider** — Video background CTA
13. **Investment Tool** — Feature showcase for investment analysis
14. **Contact** — Form + office info + map
15. **Footer** — Links, social, brokerage info
16. **AI Chatbot** — Floating chat widget (bottom-right)

## Key Features

### Trilingual i18n (EN/ES/PT)
- All translatable text uses `data-i18n` attributes
- Translations live in the `translations` object in `script.js` (line ~751)
- Language stored in `localStorage` as `poler-lang`
- Desktop + mobile language switchers with flag emojis
- Chatbot also switches language

### Custom Cursor
- Dot + ring cursor on desktop (`pointer: fine` media query)
- Ring follows with easing, expands on hover over interactive elements

### Scroll Animations
- `.reveal-up`, `.reveal-left` classes trigger on IntersectionObserver
- `--delay` CSS variable for staggered entrance

### Property Search
- Buy/Rent/Sell: standard fields (location, type, price)
- Invest tab: AI-style search bar with typing animation

### AI Chatbot
- Floating widget at bottom-right
- Trilingual greeting/responses
- Quick-reply buttons
- Hardcoded responses (no API — just pattern matching)

## Conventions

- **No build step** — edit files directly, changes go live on push
- **All CSS in one file** — organized by section with comment headers
- **All JS in one file** — DOMContentLoaded wrapper, organized by feature
- **CSS custom properties** — always use `var(--color-*)` and `var(--font-*)`, never hardcode values
- **i18n** — every user-facing string must have `data-i18n` attribute with translation in all 3 languages
- **SVG icons** — inline SVGs throughout (no icon library)
- **Responsive** — mobile-first with breakpoints in CSS
- **Lazy loading** — `loading="lazy"` on below-fold images

## Collaboration

- **Dylan** (dylanpoler-a11y) — project owner
- **Kevin** (kevinpolermiami) — collaborator
- Auto-sync runs every 2 minutes (launchd) — auto-commits tracked changes and auto-pulls remote updates
- Vercel auto-deploys from `main` branch

## Claude Code Instructions

When making changes to this project:
1. Always use CSS custom properties — never hardcode colors or fonts
2. Add `data-i18n` attributes to any new user-facing text and add translations to all 3 languages in `script.js`
3. Keep the premium, clean aesthetic — navy/white/grey palette
4. Test responsive behavior — the site must work on mobile
5. **Update this CLAUDE.md** when making significant architectural changes (new sections, new files, changed conventions)
