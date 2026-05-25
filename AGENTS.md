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
- `layouts/` — Go HTML templates.
- `static/` — Raw assets copied to site root. CSS at `static/css/style.css`, resume at `static/resume.pdf`, elevator audio at `static/sounds/`.
- `public/` is gitignored — Hugo build output.

## Quirks

- **No package.json, Makefile, or CI config.** Hugo is the only dependency. No npm/node needed.
