---
title: "The model never writes a number, part 3: running prompts like deployments"
date: 2026-11-16
summary: "DRAFT — Part three of letting an LLM write about my portfolio: versioned prompts, tests against the real model, re-judging old output, replaying past days, and the evening every model call failed while the app looked healthy."
tags: [llm, go, kubernetes]
cover: /img/posts/model-never-writes-a-number/cover-part-3.png
coverAlt: "Isometric illustration on a dark navy grid, with glowing teal and coral traces between three platforms. On the left, a tree of glowing nodes stands over a conveyor carrying a cardboard parcel with a blank tag, beside an upright scroll with empty slots outlined in orange. In the centre, a robotic arm touches a glowing amber orb under a glass dome with a small spark, and in front of it a striped barrier arm is lowered, with a coral lamp lit. On the right, a film reel unwinds a strip of scroll-shaped frames down past a dark screen, next to a panel of teal and coral bars."
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

This is the last part of a series about a small app that watches my brokerage account and sends me a daily summary, written by a language model. [Part one](/posts/2026-11-02-the-model-never-writes-a-number/) was about a model handed data that could not answer the question it was asked. [Part two](/posts/2026-11-09-the-model-never-writes-a-number-part-2/) took the numbers away from it: the model writes names, code fills in the figures in the reader's notation, and every reply is checked before it is stored.

Both were about what goes into the model and what comes out of it. This part is about the model and its prompts as things you deploy.

# Green, and broken

One evening in September I tagged a new release of the app. My cluster watches for new release images and moves the app onto them by itself, which is usually what I want. ([An earlier series](/posts/2026-10-19-a-homelab-with-nothing-to-rotate/) describes that setup.) Minutes later the new version was running. Kubernetes considered it ready, the logs were clean, and not one error had been recorded.

Every call to the model was failing. The new version sent a setting, how much the model should reason before it answers, that the model named in the app's configuration does not support. The new code needed a newer model, and the configuration still named the old one. Gemini, my provider, answered every call with HTTP 400: "Thinking level is not supported for this model".

Nothing noticed, because nothing had called the model yet. The summary runs once a day, and the news is judged once an hour. Fourteen minutes after the rollout I opened the dashboard and pressed the buttons that write a summary and fetch the news by hand. Both failed. Three minutes later, a commit moved the configuration to the new model.

The code and the model name had to move together, and the automation had moved only one of them. Every check the cluster ran said the app was fine, because every check asked whether the web server answered, and it did.

Nothing in that evening was the model getting something wrong. It never got to say anything. But it is the point of this part: a prompt and the model it runs on are deployed like code, and they break like code. By version, by configuration, by two halves being out of step. So they get what any deployment gets: a version you can trace, tests before they ship, a check that they work before they take traffic, and a way to see whether they are working once they do.

# Which prompt wrote this?

A summary changes from one day to the next for three reasons: the data changed, the model changed, or the prompt changed. Reading the summary, you cannot tell which. So each prompt has a version, a plain name such as "daily summary, version 7", and every summary is stored with the version of the prompt and the name of the model that wrote it. That was there from the first day, before I knew what I would need it for. Every fix in parts one and two was a new version.

Next to the version, in the code, sits a short history: one paragraph per version on what changed and why. It reads like a changelog. When an old summary looks odd, the stored version leads to the paragraph that says what that prompt did and did not know.

The rule for when to bump is "when what the model is told changes", not "when the prompt text changes". The second version of the summary prompt had exactly the same text as the first. What changed was which earlier snapshot it was handed as "yesterday". The text was identical and the meaning was not, and an old summary written against the wrong yesterday should be traceable as such.

That rule is also why nothing enforces the bump. A test that fingerprints the prompt text would catch a forgotten bump after an edit, and miss exactly that second version. So it is a habit, written down in the comment above the version, and a habit is not a check.

The version then pays off in two places later in this part: re-judging old output when a prompt changes, and seeing how each version is doing once it is live.

# Tests against the real model

Most of what parts one and two describe is code, and code gets ordinary unit tests: a sale is not a price move, a missing value is not zero, a reply with a stray number is retried. Those tests use a fake model that replies with whatever the test tells it to. They prove the app handles every kind of reply correctly. They cannot prove the real model will give the replies the app needs: that it writes names instead of digits without being reminded, or that a headline full of percentages does not tempt it into quoting them.

Only a real call answers that. So next to the unit tests sits a small set of live tests. Each one takes a fixed case, such as two real days of portfolio data frozen in the test or a handful of news articles chosen to be hard, sends it to the real model, and checks the reply. A model does not give the same answer twice, so each case runs several times, and one bad reply fails the test.

They need an API key, which keeps them out of the CI pipeline. I run them by hand whenever a prompt or the model changes, and the commit that makes the change says what they showed. Without a key they skip, with a message that says what is now unproven (lightly edited):

```text
SKIPPED — needs an API key. This is the only test that shows the real
model keeps the placeholder contract; a green run without it proves
nothing about that.
```

The wording matters. A skipped test shows up as green in most test runners, and green reads as "fine".

They also have to fail, not warn. Part two told how a missing figure got through because the live test logged it instead of failing on it. A log line in a test run is read by nobody.

The live tests found three of the problems in part two: the copied phrase in the news reasons, the share left out of one explanation in five, and the literal written with a sign. And when the app moved to a newer model, the move went out after the news tests had passed against it and a summary from it had been read by hand.

That last one is worth a second look. The tests proved that the new code worked with the new model. They said nothing about which model production was configured to use, and that is what broke on the September evening above. A test of the model is not a test of the deployment.

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
