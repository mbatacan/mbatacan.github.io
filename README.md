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

## Adding/updating a lab project

Edit `src/data/lab-projects.ts`. Each entry has a `status` of `completed`, `in-progress`, or `idea` — the `/lab` page groups by that automatically. A `completed` entry needs an `href` to link to; the other two render as a non-clickable card since there's nothing to send anyone to yet.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the site and pushes `dist/` to the `gh-pages` branch. GitHub Pages is configured to serve from that branch.
