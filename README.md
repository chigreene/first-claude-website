# Personal Portfolio

A premium, dark, mobile-first portfolio built with **semantic HTML, modern CSS, and vanilla JavaScript** — no frameworks, no build step, no dependencies.

---

## Design direction — "Instrument panel"

The site treats a developer portfolio like a precise instrument: a deep, cool
ink canvas with a single **warm signal-amber accent**. The warmth against the
cold technical ink is the point of view — a builder with judgment and a human
touch, not a generic "dark theme + neon" template.

**Signature element:** a fixed monospace **HUD side-rail** (desktop) that indexes
the page `00–05` and highlights the active section as you scroll. The numbering
is honest — it reflects a real, ordered reading path.

| Token group | Choice |
|---|---|
| **Type** | Space Grotesk (display) · IBM Plex Sans (body) · JetBrains Mono (labels/data) |
| **Surfaces** | ink `#0A0B0F` · surface `#101218` · elevated `#16191F` |
| **Text** | primary `#ECEEF2` · muted `#9AA1AC` (≥4.5:1) · faint `#6B727D` |
| **Accent / states** | accent `#F2B65A` · focus `#7CA8FF` (deliberately cooler) · success `#5BD6A0` · error `#FF6B6B` |
| **Motion** | spotlight follow, scroll reveal, card glow — all GPU `transform`/`opacity`, all gated by `prefers-reduced-motion` |

All values live as CSS custom properties at the top of `styles.css`.

---

## Files

```
index.html    Structure and content (semantic landmarks)
styles.css    Design tokens + all styling (mobile-first)
main.js       Progressive-enhancement interactions
```

---

## Run it

No build needed. Either:

```bash
# Option A — just open it
open index.html          # macOS  (use 'xdg-open' on Linux)

# Option B — serve it (recommended; lets fonts/anchors behave normally)
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy it

It's static — drop the three files on any host:

- **GitHub Pages:** push to a repo, enable Pages on the branch root.
- **Netlify / Vercel / Cloudflare Pages:** drag the folder in, or point at the repo. No build command, publish directory = project root.

---

## What's intentionally built in

- Semantic landmarks (`header`, `nav`, `main`, `section`, `footer`) and a skip link
- Keyboard navigable, with visible focus rings distinct from the accent color
- `prefers-reduced-motion` fully respected (animations stripped, not just slowed)
- **Graceful degradation:** content is fully visible with JavaScript disabled
  (reveal animations are gated behind a `.js` flag)
- Mobile-first CSS, fluid type/space scales, no horizontal overflow
- Pointer-aware spotlight + card glow only on fine pointers (skipped on touch)

---

## Assumptions I made

1. **Audience:** recruiters / hiring managers / potential collaborators skimming on a phone first.
2. **Stack shown:** placeholder tech tags lean front-end (React/Next/TS) — swap for your real stack.
3. **Tone:** confident, plain-spoken, no buzzwords. Adjust to taste.
4. **Contact form** uses a `mailto:` action so it works with zero backend. If you
   deploy somewhere with form handling (Netlify Forms, Formspree), swap the
   `action` and add the relevant attributes.

---

## Placeholders to replace before publishing

Everything in `[brackets]` is replaceable copy. Search the project for `[` to find them all. Key ones:

- [ ] `[Your Name]` — appears in `<title>`, nav brand, hero, footer
- [ ] `[Target Role]` — title tag + hero role line
- [ ] `[City, Region]`, `[opportunities]` — hero status strip
- [ ] **About** — your real background + what you're building toward (two paragraphs)
- [ ] **Projects** ×3 — `[Project One/Two/Three]`, purpose, problem, your role, outcome, tech tags, and `[Live URL]` / `[GitHub URL]` / `[Case study URL]`
- [ ] **Path** — four timeline entries (current role, training, prior career, credentials)
- [ ] **Contact** — `[email@address.com]`, `[LinkedIn URL]`, `[GitHub URL]`, `[Resume URL]`

### Still needed from you to finish the copy
- Your name + the exact role/title you're targeting
- Your 2–3 strongest projects (with links if they're live)
- Your real contact links
- One or two true sentences about your background for the About section
