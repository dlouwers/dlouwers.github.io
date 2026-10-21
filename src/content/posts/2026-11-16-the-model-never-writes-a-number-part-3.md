---
title: "The model never writes a number, part 3: running prompts like deployments"
date: 2026-11-16
summary: "Part three of letting an LLM write about my portfolio: versioned prompts, tests against the real model, re-judging old output, replaying past days, and the evening every model call failed while the app looked healthy."
tags: [llm, go, kubernetes]
cover: /img/posts/model-never-writes-a-number/cover-part-3.png
coverAlt: "Isometric illustration on a dark navy grid, with glowing teal and coral traces between three platforms. On the left, a tree of glowing nodes stands over a conveyor carrying a cardboard parcel with a blank tag, beside an upright scroll with empty slots outlined in orange. In the centre, a robotic arm touches a glowing amber orb under a glass dome with a small spark, and in front of it a striped barrier arm is lowered, with a coral lamp lit. On the right, a film reel unwinds a strip of scroll-shaped frames down past a dark screen, next to a panel of teal and coral bars."
draft: false
---

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

# A new prompt reaches nothing

Part two described the news prompt: when an article mentions one of my holdings, the model decides whether the article is really about it and writes a short explanation. Together those are the article's *verdict*, and it is stored. The new version of that prompt, the one that writes names and literals instead of numbers, passed its live tests and went out to the test setup. After two hourly polls, not one article there had a new explanation.

Nothing was broken. The app judged articles that had no verdict yet, and every article on the dashboard already had one, reached under the previous prompt. New articles would get the new prompt, but on a quiet news day none came in: two polls, nothing new. A deploy whose only change was a prompt had changed nothing anyone could see, and it would have stayed that way until the news happened to move.

That is a general property of anything that stores model output: a new prompt applies only to what is generated after it. Everything already stored was written by a prompt you have since decided was worse.

The fix uses the version from earlier. Every hour, the app takes the most recent articles and decides which of them to send to the model, in this order:

1. Articles with no verdict at all. An article nobody has assessed matters more than one assessed by an outdated prompt.
2. Articles whose verdict was reached under *another* version of the prompt than the one in force. "Another", not "older", on purpose: after a rollback, the old prompt is in force again, and verdicts from the abandoned newer one are just as out of date.
3. Nothing else. A verdict from the prompt in force is left alone.

Both groups share one limit on model calls per pass, so a prompt change works its way through over a few passes instead of in one burst of paid calls. A re-judge that fails keeps the old verdict: an article never loses the verdict it had because a newer one could not be reached.

An example, with a limit of four (the real one is larger). Version 4 of the prompt is in force, after a rollback from version 5. Of eight recent articles, A and D have no verdict. C, E and G were judged by version 3, H by version 5, and B and F by version 4. The first pass takes A and D, then fills its two remaining places with C and E. G and H wait for the next pass. B and F are not touched.

<figure class="d2-diagram" role="img" aria-label="Eight recent articles, A to H, with version 4 of the prompt in force. A and D have no verdict; C, E and G have a verdict from version 3; H from version 5, which was rolled back; B and F from version 4. Pass 1, with a limit of 4, re-judges A and D first, then C and E. G and H did not fit and go to pass 2, the next hour. B and F are left alone, because they already have a version 4 verdict.">
  <img src="/img/diagrams/model-never-writes-a-number-rejudge.svg" alt="" />
  <figcaption>One pass with a limit of four: articles without a verdict first, then verdicts from any other version, older or newer.</figcaption>
</figure>

"Recent" means a fixed number of the newest articles, not the whole history. An article older than that keeps the verdict it got, from whichever prompt was in force at the time. Re-judging years of news after every prompt change would cost calls for articles nobody reads any more.

Writing this up, I found that "recent" is not quite what the dashboard shows. The judge looks at the newest articles overall, and the dashboard shows the newest few per holding. A holding that rarely makes the news can have articles on screen that are older than anything the judge still looks at, so they would keep an old verdict for good. The fix is to let the judge look at exactly what the dashboard can show. It is not done yet.

On the test setup, the next deploy re-judged every recent article at startup and on the following hourly poll. The logs for the first 80 showed no errors. Checking whether a new prompt works on real data became a side effect of deploying it.

I left the daily summaries alone. Each one was sent to my phone on its own day, and rewriting it would change the record of what I was told.

# Did the new prompt work?

After a deploy that changes a prompt, I want answers to two questions. Has the new version reached any data yet? And does what it writes keep the rules from part two, names instead of digits?

The answers existed, in the logs and in the app's metrics. But metrics counters live in the running process, and the deploy that raised the question was also the one that restarted it. The counts started from zero at the moment I wanted to compare before and after. The logs had the detail, but a yes-or-no question should not need a search through logs.

So each summary and each news verdict now stores, next to its prompt version, how its check went: clean on the first attempt, clean after the retry, still dirty after the retry, or retry failed. That is the outcome from part two, kept in the database instead of only counted in memory. An admin page groups it by version. With invented numbers, and one column left out, the news judge's part of it looks like this:

<sl-table density="compact" stack>
  <table>
    <thead><tr><th>Version</th><th class="num">Verdicts</th><th class="num">Kept</th><th class="num">Clean</th><th class="num">Retried</th><th class="num">Dirty</th><th class="num">Unchecked</th><th style="white-space: nowrap">Last used</th></tr></thead>
    <tbody>
      <tr><td data-label="Version" style="white-space: nowrap">4, in force</td><td data-label="Verdicts" class="num">126</td><td data-label="Kept" class="num">34</td><td data-label="Clean" class="num">33</td><td data-label="Retried" class="num">1</td><td data-label="Dirty" class="num">0</td><td data-label="Unchecked" class="num">92</td><td data-label="Last used" style="white-space: nowrap">today</td></tr>
      <tr><td data-label="Version">3</td><td data-label="Verdicts" class="num">418</td><td data-label="Kept" class="num">102</td><td data-label="Clean" class="num">0</td><td data-label="Retried" class="num">0</td><td data-label="Dirty" class="num">0</td><td data-label="Unchecked" class="num">418</td><td data-label="Last used" style="white-space: nowrap">25 Sep</td></tr>
    </tbody>
  </table>
</sl-table>

The first question is answered by the "Verdicts" column and the date: version 4 has written something, and it is the one in use. The second is answered by the check columns: of the 34 kept verdicts, one needed the retry and none got through dirty. "Unchecked" holds the rest: rejected verdicts, which have no explanation to check, and everything written before outcomes were stored. That column is why version 3 shows zeros without them reading as "clean".

The metrics still exist, for trends while the process runs. The table is for the question after a deploy, which a counter that just restarted cannot answer.

# Replaying the past instead of waiting for the clock

Since part one, the summary moved to the evening. It covers the time since the previous summary, and it skips a day when nothing moved. Each of those rules is easy to state and hard to test. The question is never "does this code run", but "what would it have done last Saturday".

At first I tested that the slow way: deploy to the test setup, wait for the day in question, and read what arrived. Days per change, on a simulated account. It did find one problem, the weekend summary that retold every holding because a currency position had ticked, which part two describes. But that finding came from the data, and the data was already stored. Waiting for the clock only replayed what the database already knew.

So now the app replays it. A replay command walks the summary schedule over a stretch of stored snapshots and prints, for each time a summary was due, what the job would have done: write or skip, which earlier snapshot it compares against, which holdings moved or were still moving, and which news it would include. It runs the job's own code, not a copy of its logic, so the replay cannot drift from what the schedule does. With invented holdings, and trimmed, a weekend looks like this:

```text
Replay, 2026-09-25 to 2026-09-28, summary time 22:00. Nothing is saved or sent.

Thu 2026-09-25 22:00  writes  vs Wed 22:00  moved: ACME (still moving), FUND  quiet: WIDGET
Fri 2026-09-26 22:00  writes  vs Thu 22:00  moved: ACME (still moving), FUND, WIDGET
Sat 2026-09-27 22:00  writes  vs Fri 22:00  moved: ACME, FUND
Sun 2026-09-28 22:00  skips   nothing moved since Sat 22:00
```

Two options go further. One prints the prompt the model would have been given for each summary. The other has the real model write it. Nothing is saved and nothing is sent: the database is opened read-only, and SQLite enforces that, so a replay against production data cannot change it.

It earned its place on the first day. I had just added a rule for holdings whose move belongs to the previous trading day: a US share still settling after the evening summary, for example, should not appear in Saturday's summary as Saturday news. A replay over production data showed that the rule missed a fund whose daily price is published just before midnight. Its Friday price would have been Saturday's biggest mover. The rule was widened the same day, before that prompt version had written a single summary.

This is backtesting, the way you would test a trading rule: run the decision over the history you have, instead of waiting for the future to supply examples. It has the same limit, too. A replay only sees what was stored. Prices between two snapshots are not there, and the model's wording varies between runs, so a replay that lets the model write shows what one run said, not what it will always say. The decisions in code, write or skip and what counts as moved, come out the same every time. The words still belong to the live tests.

# The model is a dependency that can disappear

A week before the evening this part opened with, I rotated the app's API key. The new key belonged to a different cloud project, and in that project the model the app ran on did not exist. Not in the sense of "not found": it still showed up when the key listed its models. Every request to generate text was answered with 404, "no longer available to new users". Gemini keeps an older model available to projects that already used it, and refuses it to new ones.

The worse part was what the app would have done with that key. Building a client for the model makes no call to it, and the app's own checks only complained when the key was missing altogether. A pod with the new key would have started, passed its health checks, and failed every summary, news judgement and alert. It surfaced on the test setup, where the rotation started. Production kept its old key, which turned out to work with newer models too: the restriction only runs one way.

So the app moved to a newer model, and that move needed new code: the newer model rejects the old way of switching off its reasoning, outright, with HTTP 400. That is how code and model came to depend on each other, and that is the dependency the evening in September broke: the new code reached production, and the configuration still named the old model.

Three things about this kind of dependency are worth saying plainly:

- **A model can go away without being deleted.** It can stay listed and stop answering, for you, because of which project you are in. Nothing in the API said so until a real call was made.
- **Code and model are versioned together.** A setting the code sends can be valid for one model and an error for the next.
- **The way they reach production can split them.** Here, tagging a release is what releases it: the cluster picks up the new image by itself. The configuration moves in its own commit. Releasing both in one commit fixed that evening, but it is a habit again, and nothing stops the next tag from going out on its own.

What closes the gap is a check before the new version takes traffic. Kubernetes has a probe for exactly that: a startup probe runs when a container starts, and the container counts as ready only once it passes. The app's startup probe asks one question: has every part of the app that calls the model made one real call, with its own real configuration, and got an answer? There are three such parts: the summary, the news judge, and the triage that decides whether an alert is worth a notification. Each has its own response format, reasoning setting and token limit, and on that evening all three broke at once.

<figure class="d2-diagram" role="img" aria-label="Sequence between the rollout, the new pod, its database and the model API. 1: the new pod asks its database whether this build and configuration passed before; the answer is no. 2: the pod makes one call per component to the model API. If it fails: 3, the model returns an error, and 4, the pod reports not ready, so the old pod keeps serving. If it passes: 5, the model answers, and 6, the pod reports ready and the result is remembered.">
  <img src="/img/diagrams/model-never-writes-a-number-startup-check.svg" alt="" />
  <figcaption>A new version takes traffic only after every part that calls the model has made one real call. Until then, the old version keeps serving.</figcaption>
</figure>

The details are what make it safe to run:

- **Once per process.** The calls run in the background at startup and the probe only reports the result. A container that fails its probe is restarted, and each restart makes one attempt, so a crash loop does not become a stream of paid calls.
- **Only success passes.** The check does not try to tell my mistakes from the provider's outages. My own mistakes can look like outages: a network rule that blocks the provider shows up as timeouts. If the provider is down during a rollout, the rollout waits, and the old version keeps serving.
- **What passed is remembered.** Once a build and configuration pass, the app stores that, with the model name, the token limit and a fingerprint of the key. A pod starting with a combination that already passed skips the calls. That way the check blocks a change, not every restart: if a node dies during an outage, its replacement still starts. And a new key is a new combination, so rotating the key is checked again.
- **Readiness stays cheap.** The regular readiness check still only asks whether the web server answers. It runs every few seconds for the life of the pod, so it must not cost a model call.

It was proven by breaking it on purpose. On the test setup I set a model name that passes the app's own configuration checks but does not exist. The new pod never became ready, each restart made exactly one attempt and got a 404, and after three minutes the deployment tool marked the release as failed. The revert brought it back: one passing check, ready, serving.

The evening in September would now look different. The new code would have started, made three calls, got three errors, and stayed out of service. The old version would have kept writing summaries until the configuration caught up.

# What is left for the model

Three parts, one direction. Part one took the facts away from the model: unknown stays unknown, and a sale is worked out as a sale before the prompt is written. Part two took away the numbers: the model writes names, and code fills them in, in the reader's notation, after checking every reply. This part treated the prompt and the model as what they are in production: a versioned dependency, tested against the real thing, rolled out behind a check, and watched afterwards.

What is left for the model is the part it is good at. It decides which of the facts lead, how much weight each one gets, and how to say it in three short paragraphs I want to read. That is still most of what makes the summary worth having. It is also the only part I can no longer check with a test, so it is the part I read.

If you are about to put model-written text next to real data, this is what I would set up from the start, in the order it paid off for me:

- **Treat every value in the prompt as a claim.** Missing is "unknown", never zero, and anything the model would have to infer is worked out in code and stated.
- **Keep numbers out of the model's reply.** Let it write names, fill them in when the text is shown, and check every reply for stray digits.
- **Version every prompt, and store the version with every output.**
- **Test against the real model**, a handful of fixed cases, several runs each, failing loudly, and skipping loudly when there is no key.
- **Gate the rollout on one real call per component**, with the real configuration, so a pod that cannot reach its model never takes traffic.

Not everything is done. A deposit still reads as a gain, and the news judge still looks at a slightly different set of articles than the dashboard shows. Both are written down, and neither is the model's fault. That, in the end, is what the whole series amounts to: when the summary is wrong now, the reason is usually in my code, where a test can find it.
