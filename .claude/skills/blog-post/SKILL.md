---
name: blog-post
description: Write, illustrate and publish a post on blog.stormlantern.nl, from outline to live page. Use when drafting or revising a post in src/content/posts, making its diagrams or cover, splitting it into a series, or publishing it.
---

# Writing a post for this blog

The mechanics (file naming, frontmatter schema, diagrams, scheduled publishing)
are in `README.md`. Read it first. This skill is the part the README does not
cover: how a post gets from idea to live page without embarrassing anyone, and
the mistakes that were already made once.

## This repository is public

Pushing a branch is publishing it, before any merge. So:

- Draft on a local branch (`post/<slug>`; `draft/…` clashes with an existing
  branch). Commit per section so each rewrite can be compared.
- Ask before every push, and again before every merge. Approval for one is not
  approval for the next.
- Scheduling is not embargo (see README): a merged future-dated post is
  readable on GitHub at once.

## Work in this order

1. **Outline first, prose later.** Propose an outline and let the author react
   before writing prose. Then write one section at a time, on request, and
   summarise what each section does when you hand it over.
2. **Read the outline as an outsider before showing it.** The first outline for
   the homelab post "read like someone with intimate knowledge talking to
   themselves": issue numbers, file names and abbreviations a reader has never
   seen. If a sentence only makes sense to someone who has read the source
   repository, rewrite it.
3. **Prose rules**, which also go in a comment at the top of the draft while it
   is being written:
   - State who the reader is and what they do *not* know. Explain every term
     the first time, in one plain sentence, or do not use it.
   - No issue numbers, internal file names or resource names. Name things by
     their role ("the workflow that builds the image").
   - Code only where a reader could reuse it, trimmed, with placeholders like
     `<your registry's host>`.
   - For every mechanism: what proves what to whom, and what happens when that
     proof is missing. The failure case is what makes it believable.
   - Stay vendor-neutral when the idea is the subject. Name the author's vendor
     once, next to its equivalents, and mark provider-specific syntax as one
     example of many.

## Claims

- **Check vendor claims against primary documentation** (the vendor's docs,
  release notes, the source code of the tool) before they go in, and keep the
  links. Two claims in the homelab draft were wrong until checked.
- **Check claims about the author's own setup against the setup itself**: the
  config, the scripts, the issue where it was verified. "Rehearsed", "tested"
  and "verified" need evidence. If you cannot find it, write "should", or say
  it has not been tried.
- **Do not generalise past what was shown.** Two corrections from the author
  on one sentence: a plugin written for self-run clusters pulling from Google's
  registry is not needed "on Google" (GKE has its own), and the official AWS and
  Azure plugins do not "just work" from a home cluster (those clouds need a
  publicly reachable issuer first). When saying where something applies, say
  exactly where, and what else it needs there.

## Diagrams

D2, pre-rendered to SVG (README). What worked and what did not:

- Flows read best as `shape: sequence_diagram` with numbered messages.
  Architecture overviews: `direction: down`, few containers.
- The dagre layout ignores per-container `direction`; ELK and grids with edges
  rendered badly. Change the diagram, not the engine.
- Size: render, then check the SVG's width and height. Aim for roughly
  550–760 px wide and under ~800 px tall; split labels over lines with `\n`.
- The `<figure class="d2-diagram">` block must not contain blank lines, or
  markdown breaks it apart. Write a real `aria-label` describing the content
  and set `alt=""` on the `<img>`.
- The build inlines that `<img>` as the SVG itself, so the diagram follows the
  dark-mode toggle. Check a new diagram in dark mode in `astro dev` too; a
  diagram shown as a plain image would stay light.
- Captions and aria-labels are final text. Search for `DRAFT` before merging.

## Covers

- The layout shows covers at **16:9** with `object-fit: cover`. Generate 16:9
  directly, at least 1536 px wide. A square image cropped to 16:9 loses either
  the top or the bottom of the scene; ask the generator to *extend the canvas*
  sideways instead of cropping.
- Prompts that matched the existing covers are in `cover-prompts.md` next to
  this file.
- Before using an image: view it at full size, check the bottom-right corner
  for a generator watermark, and check what it actually shows. Generators
  reinterpret (a requested badge became a seedling).
- `coverAlt` describes the image as delivered, not the prompt.
- Store as `public/img/posts/<slug>/cover.png`. Covers also become the
  `og:image` link preview, so a post without one gets the site hero.

## Frontmatter traps

- A value containing `: ` breaks the YAML (`summary: … Part one: …`). Quote
  `title`, `summary` and `coverAlt` when in doubt.
- `draft: true` hides a post everywhere, **including `astro dev`**, so links to
  it 404 while proofreading. To proofread an unpublished post in place, give it
  a future date and `draft: false`: dev shows it, the production build does not.

## Series

- Split at a section boundary once the whole text exists, not before.
- Part 2 opens with a short recap of part 1 for readers who land on it first,
  and links back.
- Part 1 must not link to a part that is not live yet: it 404s. Name the date
  in plain text ("out on 26 October"), and add the link in a follow-up PR on
  that date. Put that PR in the author's task list; a scheduled agent job may
  not survive until then.
- Fix every "later in this post" and "the last section" when splitting.
- Posts on the same date list in file-name order (`byDateDesc` in
  `src/lib/posts.ts`).

## Before merging

- `npx astro build` passes. (Build to the default `dist/`: an `--outDir` on
  another filesystem fails with a rename error.) Check in `dist/` that every
  internal link in the post resolves to a built page.
- No outline comments (`<!--`) and no `DRAFT` left in the post; sources go in
  the PR description instead.
- If anything relies on the schedule, check that the Deploy workflow is still
  enabled. GitHub disables scheduled workflows after 60 days without activity,
  and it did on this repository:

  ```sh
  gh api repos/dlouwers/dlouwers.github.io/actions/workflows \
    --jq '.workflows[] | "\(.name) \(.state)"'
  ```

  `disabled_inactivity` means a merge deploys nothing and dated posts never
  appear. Re-enable with `gh workflow enable deploy.yml`, then
  `gh workflow run deploy.yml` (after asking).

## After merging

- Wait for the Deploy run **of the merge commit**, not the latest run in the
  list, which may be an old one.
- `curl` the live URLs (post, cover, diagrams) for 200, and the page head for
  `og:image`.
- Slack caches link previews (about half an hour) and site icons for longer.
  Re-sharing the same URL shows the old preview; appending `?` makes it fetch a
  new one.
