# chetaldrich.com

Personal site built with [Hugo](https://gohugo.io), deployed on Netlify (auto-deploys from `master`).

## Commands

| Action | Command |
|--------|---------|
| Dev server with live reload | `hugo server` |
| Build (outputs to `public/`) | `hugo` |

## Structure

- `config.toml` — site config.
- `content/` — Markdown content. Homepage at `content/_index.md`.
- `data/experience.json` — the work history rendered by `layouts/index.html`. Company `url` and `roles` only; company names are set as text in the prose serif, not as logo images.
- `layouts/` — Go HTML templates. `partials/signature.html` holds the hand-drawn SVG signature inline, and is only reached from the non-home `masthead`.
- `static/` — Raw assets copied to site root: `css/style.css`, `js/ridge.js` (the shared hero canvas engine), `js/winter-theme.js`, `js/spring-theme.js`, `js/summer-theme.js`, `js/autumn-theme.js` (season scene data), `resume.pdf`, `images/favicon.svg`, `images/signature_animated.svg`.
- `public/` is gitignored — Hugo build output.

## Quirks

- **No package.json, Makefile, or CI config.** Hugo is the only dependency. No npm/node needed.
- **No webfonts.** Both type stacks in `style.css` are built from faces that ship with macOS/Windows/Linux, so the page renders with zero font requests but is not pixel-identical across platforms.
- **The one-bit look is the point.** The hero is a dithered 1-bit scene; resist adding smooth gradients, rounded corners, or shadows to the surrounding UI.
