---
title: "The model never writes a number, part 1: harnessing and localising LLM output"
date: 2026-11-02
summary: "DRAFT — I let an LLM write a daily summary of my investment portfolio. It read well and was wrong in five different ways. The fix: code decides the facts and how they are formatted, the model decides only the words."
tags: [llm, go, localisation]
draft: false
---

<!--
PROSE RULES (remove before merge)
- Reader: a backend developer who has put, or is about to put, LLM-written
  text next to real data. Knows what an LLM and a prompt are. Does NOT know
  investor-buddy, Saxo, Eino, the issue tracker, or this author's setup.
- Explain every term the first time, in one plain sentence, or drop it.
- No issue numbers, file names, prompt version ids, or resource names.
- Every number in the post is invented. No tickers, no amounts, no weights,
  no account details from the real portfolio.
- For each fix: what it proves, and what happens when it fails.
- Vendor-neutral: Gemini named once, next to equivalents.
-->

# A summary that read well

I have a small app that watches my brokerage account. Every few minutes it records what I hold and what it is worth, and once a day it sends a notification to my phone: a few paragraphs, written by a large language model, about what changed.

The first summaries were a pleasure to read. Calm, specific, in the tone of a newsletter written for one reader. They were also wrong, in several different ways, and I could not tell by reading them. One of them described a holding I had partly sold as having crashed.

This post is about how that got fixed, in the order things broke. Each fix took a job away from the model and gave it to code, until the model was left with one: choosing the words. It no longer writes a single number. Code works out every figure, and formats it for whoever is reading, in their own notation. A second part, out on DRAFT-DATE, is about running those prompts once they are in production.

# Version one: hand it the data and ask nicely

The first version did what most first versions do. It took two snapshots of the portfolio, today's and yesterday's, wrote them into the prompt as plain text, and asked for three paragraphs. Trimmed, and with invented numbers, the prompt looked like this:

```text
You are writing a brief daily update for the user about their own
personal investment portfolio. Plain text, three paragraphs.

Today's snapshot (2026-04-24):
- Total value: 52418.37 EUR
- Cash balance: 2104.90 EUR
- ACME (Stock): qty 120, market value 9843.60 USD, unrealised P/L +612.40

Previous snapshot (2026-04-23):
- Total value: 51987.02 EUR
- ACME: market value 9790.80 USD

Write three paragraphs:
1. Headline: the overall change in portfolio value since the previous
   snapshot, as an amount and a percentage.
2. Notable movers: up to three positions with the largest change in
   market value or profit and loss.
3. One concrete, factual observation about concentration, idle cash or
   currency exposure. Do not give financial advice.
```

Look at what yesterday's lines carry, and what they leave out. That comes back later.

The model was Google's Gemini Flash, the fast and cheap tier. This post is about what goes around the model, and none of it depends on which one you use. The replies were good. They picked the right holdings to talk about, put a sensible amount of weight on each, and read like someone had looked at my account and thought about it.

That was the problem. A table of numbers invites you to check it, and a well-written paragraph invites you to nod along. Every figure the model needed was in the prompt, so I assumed that repeating them back was the easy part. Nothing compared the reply with the data. Whatever came back was stored and sent to my phone as it was.

<!--
OUTLINE — part 1 (journey: what was tried, what failed, what replaced it)

0. Opening (~150 words)
   - The app in two sentences: a small self-hosted app that watches my
     brokerage account and sends one push notification in the evening, a
     few paragraphs on what moved.
   - Hook: the first summaries read well, and were wrong in ways I could not
     see by reading them. One reported a sale as a crash.
   - Promise: the journey, the failures in order, and where it ended up:
     code decides the facts and their format, the model decides the words.

1. Version one: hand it the data and ask nicely
   - Snapshots of today and yesterday rendered into a prompt, "write three
     paragraphs". It sounded like a financial newsletter. That was the problem:
     fluent text gets read as checked text.

2. Failure: a missing value is not zero
   - A field the broker did not return was rendered as 0.00. The model
     concluded the portfolio had lost most of its value and cash was 100% of it.
   - Fix: missing renders as "unknown", and the prompt says what unknown means
     (do not compute with it, do not assume zero). Before/after quote, invented
     numbers.
   - The sting: months later, a field that was zero in every stored row, marked
     as present. The "unknown" guard never fired, because the data did not
     claim to be missing. It was the right answer to the wrong question (a
     margin figure on an account without margin). Lesson: the model trusts
     your zeros more than you do.

3. Failure: a sale reported as a crash
   - Sold most of one holding; the summary said it had fallen sharply.
   - Not a hallucination: today's positions had a quantity, yesterday's only a
     value. With that input, a sale and a price fall are the same thing. The
     model was asked a question its data could not answer.
   - What I nearly did: add the quantity to yesterday too. Rejected, because
     the model would still be doing arithmetic on raw figures.
   - What I did: compute the movement in code. Market move is the quantity
     actually held times the price move; value change is kept separately;
     opened and closed positions are explicit entries; ranking in one
     currency (it had been comparing dollars to euros as raw numbers).
     The prompt narrates a computed result. And code is unit-testable;
     a prompt is not.
   - Same pattern, smaller: cash share derived by subtracting positions from
     the total, while sale proceeds sat in neither. Fix: state the unsettled
     amount explicitly. Honest bit: deposits and withdrawals still cannot be
     told apart from market movement. Mitigated, not fixed.

4. Failure: numbers in a style of its own
   - Same amount written three ways on three days, two percentage styles in
     one paragraph, never in the reader's locale (I read Dutch notation).
   - Worse: it did sums of its own. A holding just under half the portfolio
     was described as "more than half".
   - Tried first: more rules in the prompt ("never contradict the figure").
     It helps; it is a request, not a guarantee.

5. The fix: the model writes names, not numbers
   - Split who decides what from who decides how:
     code computes every figure the text may state and names it;
     the model writes {total_today}, never digits;
     the text is stored with the placeholders plus the named values, so it
     is locale-neutral;
     every reader surface (dashboard, push notification) fills them in that
     reader's locale with the same formatting code as the rest of the UI.
   - Detail that matters: figures render without a sign, direction is the
     prose's job. A signed render gives "fell by -133". So the model must
     know a placeholder renders as a magnitude.
   - Numbers the code cannot know in advance (a news article saying "crude
     fell 3.6%") are written as literals in one fixed notation, {=3.6%}, and
     formatted per reader like the rest.
   - A side effect: switching your locale re-renders summaries written
     before the switch.
   - Short Go snippet: the Figure type and the render step. Reusable, trimmed.
   - DIAGRAM: sequence — snapshot → code computes named figures → prompt →
     model → check (retry once) → store locale-neutral → render per reader
     (dashboard in nl, push in en).

6. The harness: trust, but check every reply
   - Every reply is scanned for stray numbers. One violation: retry once,
     naming the violations. Still dirty: keep whichever reply is less bad,
     and record that it happened. The outcome is stored on every summary,
     so I can see per prompt how often the contract holds.
   - Result against the real model: all replies clean on the first attempt
     in the live test runs; the retry is a seatbelt, not the mechanism.
     (Check exact counts before stating them.)
   - What fails if the check is missing: digits in the model's own style
     ship to the reader, unnoticed, because they read fine.

7. Two smaller lessons from the same harness
   - Give a model an example phrase and it copies it. The news filter gave
     three sample rejection reasons; three of five rejections came back with
     the same sample sentence. The verdicts were right, the audit trail was
     useless. Fix: no copyable example, ask for the subject instead.
   - "Mention it where it matters" is a judgement handed to the model. If the
     answer is always "yes", require it.
   - What the model sees, it uses: summaries retold unchanged holdings every
     day because the prompt listed them. Fix by changing the input, not by
     adding "don't mention".

8. Closing: where the line sits
   - Code: facts, arithmetic, units, format, locale. Model: selection,
     emphasis, wording.
   - Where this does not fit (free-form chat about numbers the code cannot
     precompute) and what I'd do there.
   - Part 2 (out on <date>, plain text, no link): running prompts like
     deployments. Versioned prompts, re-judging old output when a prompt
     changes, tests against the real model, replaying past days, and the
     morning every LLM call failed while the app reported healthy.
-->
