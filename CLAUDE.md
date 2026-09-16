# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Static personal portfolio/blog site built with [Astro](https://astro.build) and hosted on GitHub Pages. Dark navy theme (`#222a68`), monospace (Courier Prime) font, no JavaScript framework.

**This is a static site with no server.** Anything that needs a backend or a secret (a database, a hosted-LLM API call with your own key, etc.) doesn't belong here — it would either not work at all on GitHub Pages, or leak the secret into the public bundle. The `/lab` demo runs its model entirely client-side for this reason: weights are fetched from a public CDN and inference happens in the visitor's browser.

## Commands

```bash
npm run dev      # dev server at http://localhost:4321
npm run build    # static build → dist/
npm run preview  # preview the built dist/ locally
```

## Architecture

```
src/
  layouts/
    BaseLayout.astro      # HTML shell, imports global.css, meta tags, favicon, page-wrapper div
  components/
    ProfileHeader.astro   # Large profile photo + name + social icons — homepage only
    SiteHeader.astro      # Compact avatar + name + SiteNav — every other page
    SiteNav.astro         # Blog/About/Lab/Log links, highlights the current page
    Footer.astro          # Copyright line only; no props
  styles/
    global.css            # All styles — shared layout, header/nav, blog, about, lab, log
  pages/
    index.astro            # Homepage
    about.astro             # About page
    blog/
      index.astro            # Blog listing (auto-sorted by date from content collection)
      [slug].astro            # Dynamic blog post renderer
    lab/
      fool-the-classifier.astro  # Client-side ONNX sketch-classifier demo/game
    log.astro               # Recently-pushed-to repos, fetched from GitHub at build time
    404.astro               # Custom not-found page
  scripts/
    sketch-classifier.ts   # preprocess/loadSession/classify for the lab demo (browser-only)
    game.ts                # Pure target-picking and win-check logic for the lab demo
  data/
    quickdraw-labels.json      # The 345 QuickDraw class labels, in model output order
    quickdraw-game-classes.ts  # Curated subset used as game targets
  lib/
    github.ts              # fetchRecentActivity() — GitHub API calls, runs at build time only
  content.config.ts        # Blog collection schema (title, date, description)
  content/
    blog/
      *.md                  # One Markdown file per post with frontmatter
public/
  favicon.svg
  assets/
    images/                 # profile.jpg, and per-post images
    icons/                  # Social icons, org logos
.github/workflows/
  deploy.yml                # Build + push dist/ to gh-pages, on push/schedule/dispatch
```

## Adding a new blog post

Create `src/content/blog/<slug>.md` with this frontmatter:

```markdown
---
title: "Post Title"
date: 2024-01-15
description: "One-sentence description shown in meta tags."
---

Post content in Markdown...
```

The blog index auto-updates — no manual link list needed. The URL becomes `/blog/<slug>`.

## Adding a page

Every page except the homepage uses `SiteHeader` (not `ProfileHeader`) and `Footer` with no props — nav is defined once in `SiteNav.astro`, not per-page. Add the route there when adding a new top-level section.

## Deployment

Push to `main` → GitHub Actions builds the site and pushes `dist/` to the `gh-pages` branch (`peaceiris/actions-gh-pages`, pinned to a commit SHA). GitHub Pages serves from that branch. The workflow also runs on a daily cron so `/log` reflects recent GitHub activity even without a push.

`GITHUB_TOKEN` is passed to the build step so `src/lib/github.ts` gets a higher API rate limit — this is the Actions-provided token, not a manually configured secret.
