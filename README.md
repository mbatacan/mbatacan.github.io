# mbatacan.github.io

Personal portfolio and blog, built with [Astro](https://astro.build) and deployed to GitHub Pages.

**Live at:** https://mbatacan.github.io

## Stack

Static site, no client-side framework. Dark navy theme, monospace (Courier Prime) font. One page in the site — `/lab/fool-the-classifier` — runs a real pretrained neural net (ONNX, via `onnxruntime-web`) entirely in the browser; there's no server anywhere in this project.

## Commands

```bash
npm install
npm run dev      # dev server at http://localhost:4321
npm run build    # static build → dist/
npm run preview  # preview the built dist/ locally
```

## Adding a blog post

Create `src/content/blog/<slug>.md`:

```markdown
---
title: "Post Title"
date: 2024-01-15
description: "One-sentence description shown in meta tags and the blog listing."
---

Post content in Markdown...
```

The blog index picks it up automatically, sorted by date. URL becomes `/blog/<slug>`.

## Project log

`/log` lists the repos most recently pushed to under this GitHub account, with their latest commits — fetched from the GitHub API at build time (`src/lib/github.ts`), not hand-maintained.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the site and pushes `dist/` to the `gh-pages` branch. GitHub Pages is configured to serve from that branch. The workflow also runs on a daily schedule so `/log` stays current even without a push.
