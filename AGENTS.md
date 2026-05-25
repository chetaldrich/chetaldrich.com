# chetaldrich.com

Personal site built with [Hugo](https://gohugo.io), deployed on Netlify (auto-deploys from `master`).

## Commands

| Action | Command |
|--------|---------|
| Dev server with live reload | `hugo server` |
| Build (outputs to `public/`) | `hugo` |
| New blog post | `hugo new blog/my-post.md` |

## Structure

- `config.toml` — site config. Notable: blog permalinks are `/:filename/` (no date prefix), tags taxonomy enabled.
- `content/` — Markdown content. Blog posts under `content/blog/`.
- `layouts/` — Go HTML templates. Blog posts use `layouts/blog/single.html`, which includes the elevator.js UI.
- `static/` — Raw assets copied to site root. CSS at `static/css/style.css`, resume at `static/resume.pdf`, elevator audio at `static/sounds/`.
- `public/` is gitignored — Hugo build output.

## Quirks

- **No package.json, Makefile, or CI config.** Hugo is the only dependency. No npm/node needed.
- **Elevator.js** — the script is vendored at `static/js/elevator.js` (from [tholman/elevator.js](https://github.com/tholman/elevator.js)). Audio files are at `static/sounds/`. The blog post template (`layouts/blog/single.html`) references them via `/sounds/` paths.
