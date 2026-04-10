# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Static personal portfolio/blog site built with [Astro](https://astro.build) and hosted on GitHub Pages. Dark navy theme (`#222a68`), monospace (Courier Prime) font, no JavaScript framework.

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
    BaseLayout.astro      # HTML shell, imports global.css, meta tags, page-wrapper div
  components/
    ProfileHeader.astro   # Profile photo + name + social icons (used on every page)
    Footer.astro          # Nav links + copyright (accepts links[] prop)
  styles/
    global.css            # All styles — shared layout, profile header, blog, about
  pages/
    index.astro           # Homepage
    about.astro           # About page
    blog/
      index.astro         # Blog listing (auto-sorted by date from content collection)
      [slug].astro        # Dynamic blog post renderer
  content/
    config.ts             # Blog collection schema (title, date, description)
    blog/
      *.md                # One Markdown file per post with frontmatter
public/
  assets/
    images/               # profile.jpg, atfal.jpeg
    icons/                # Social icons, org logos
.github/workflows/
  deploy.yml              # GitHub Actions → GitHub Pages deployment
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

## Deployment

Push to `main` → GitHub Actions builds Astro and deploys to GitHub Pages automatically.

For this to work, GitHub Pages must be set to deploy from **GitHub Actions** (not the legacy branch source) in the repo Settings → Pages.
