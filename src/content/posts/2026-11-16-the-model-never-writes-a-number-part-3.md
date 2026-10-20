---
title: "The model never writes a number, part 3: running prompts like deployments"
date: 2026-11-16
summary: "DRAFT — Part three of letting an LLM write about my portfolio: versioned prompts, tests against the real model, re-judging old output, replaying past days, and the evening every model call failed while the app looked healthy."
tags: [llm, go, kubernetes]
draft: false
---

<!--
PROSE RULES (remove before merge)
- Reader: a backend developer who runs LLM features in production, or is
  about to. Has read parts 1–2, or the recap. Does NOT know investor-buddy,
  the issue tracker, or this author's setup. Knows what a Kubernetes probe
  is only if explained in one sentence.
- No issue numbers, file names, prompt version ids, resource names, image
  tags or metric names.
- Every number from the portfolio is invented. Times and counts from tests
  and incidents may be real.
- For each mechanism: what it proves, and what happens when it is missing.
- Gemini may be named where the failure is specific to it (model retirement,
  thinking config); say what the general lesson is.
- The author is the app's only user.
-->

<!--
OUTLINE — part 3 (journey: what broke, what replaced it)

0. Recap (~100 words), links to part 2.

1. Opening: green, and broken (~200)
   - One September evening the app was rolled onto a new version. The pod
     was Ready, logs clean, zero errors. Every model call returned 400,
     because nothing had made one yet. Found 14 minutes later, by clicking
     "generate summary" by hand.
   - Promise: a prompt plus its model is a deployable thing. It gets what
     any deployment gets: a version, tests, a rollout check, and a way to
     see whether it works once live.
   - TO CHECK: what moved prod onto the new image before the model pin.

2. Which prompt wrote this? (~250)
   - Every prompt carries a version name; every summary and verdict stores
     the version that produced it. Without it, a changed summary could be
     the data, the model or the prompt, and you cannot tell which.
   - When does a change get a new version (convention, check in code).

3. Tests against the real model (~400)
   - Unit tests pin everything code does (part 1's point). They cannot pin
     the model. So: a small set of live tests that call the real model on
     real, frozen cases, run on demand, several times each.
   - They need a key. Without one they skip, loudly, never pass silently.
   - Assert, don't log (callback to part 2's warning nobody read).
   - What they caught, briefly: the copied phrase, the missing share, the
     signed literal, a model upgrade that rejected the old thinking setting.

4. A new prompt reaches nothing (~300)
   - Shipped a better news prompt. Nothing changed on screen: only new
     articles get judged, and none arrived in two polls.
   - Fix: also re-judge recent verdicts reached under *another* version
     (not "older": a rollback re-judges too), sharing the per-pass cap,
     keeping the old verdict when a re-judge fails.

5. Did the new prompt work? (~250)
   - The answers were in logs and metrics counters, which reset on the very
     deploy that raised the question. Now each output stores its check
     outcome (part 2), and an admin page shows per version: rows produced,
     outcomes, last used, version in force.

6. Replaying the past instead of waiting for the clock (~350)
   - Testing a schedule change meant waiting for days on the test setup.
     The one real finding it produced (the weekend currency tick, part 2)
     came from data already stored.
   - A replay command walks the summary schedule over stored snapshots,
     through the job's own code: write or skip, what it compares against,
     what moved, which news. Optionally prints the prompt, optionally lets
     the real model write. Database opened read-only, enforced by SQLite.
     Backtesting, the way you would for a trading rule.

7. The model is a dependency that can disappear (~500)
   - Key rotation: the new key, from a different cloud project, could not
     use the model the app ran on. Grandfathered per project. The model
     still showed up in the list of models; only calls to it failed. And
     the app would have started green: building a client never calls the
     API.
   - Then the evening from section 1: code and model pin out of step.
     Fix one: release them in one commit, so there is never a window.
   - Fix two: a startup check. Before the pod counts as ready, each model
     component makes one minimal real call with its own real configuration.
     Runs once per process, so a crash loop is not a stream of paid calls.
     Passes only on success, so an outage blocks a rollout and the old pod
     keeps serving. A build + configuration that passed once is remembered,
     so a replacement pod still starts during an outage.
   - Proven by breaking it on purpose on the test setup: a model name that
     does not exist kept the new pod out of service, the deploy reported
     unhealthy, the revert brought it back.
   - DIAGRAM: sequence — rollout → pod starts → self-check calls model →
     fail: stays unready, old pod serves / pass: record build+config, ready.

8. Closing: the series in one line (~200)
   - Part 1: the model's input is a claim. Part 2: its output is untrusted
     input. Part 3: the model is a dependency, deployed and monitored like
     one.
-->
