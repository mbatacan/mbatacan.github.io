# mbatacan.github.io

My portfolio and blog, built with [Astro](https://astro.build) and hosted on GitHub Pages: https://mbatacan.github.io

## Setup

Requires Node 22.

```bash
npm install
npm run dev        # dev server at http://localhost:4321
npm run build      # static build -> dist/
npm run preview    # preview the built site
npm test           # run the tests
```

## Adding a blog post

Create `src/content/blog/<slug>.md`:

```markdown
---
title: "Post Title"
date: 2024-01-15
description: "One-sentence description."
---

Post content in Markdown...
```

It shows up on the blog page automatically, sorted by date.

## Deployment

Pushing to `main` builds the site and publishes it to the `gh-pages` branch, which GitHub Pages serves.

## License

Code is [MIT](LICENSE). Blog posts and images are all rights reserved.
