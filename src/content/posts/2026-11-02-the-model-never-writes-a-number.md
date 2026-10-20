---
title: "The model never writes a number, part 1: harnessing and localising LLM output"
date: 2026-11-02
summary: "DRAFT — I let an LLM write a daily summary of my investment portfolio. It read well and was wrong in five different ways. The fix: code decides the facts and how they are formatted, the model decides only the words."
tags: [llm, go, localisation]
cover: /img/posts/model-never-writes-a-number/cover.png
coverAlt: "Isometric illustration on a dark navy grid. On the left, a machine with brass gears behind glass takes in a stack of dark blocks and sets out a row of glowing teal tiles. In the centre, a glowing orb shines a beam onto an unrolled scroll of wavy lines with empty slots outlined in orange. On the right, a phone and a monitor show the same kind of page with teal tiles in the slots."
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
- The author is the app's only user. No customers, users or testers;
  "the reader" of a summary is the author. Per-locale rendering is about
  what the design allows, not about an audience it has.
-->

# A summary that read well

I have a small app that watches my brokerage account. Every few minutes it records what I hold and what it is worth, and once a day it sends a notification to my phone: a few paragraphs, written by a large language model, about what changed.

The first summaries were a pleasure to read. Calm, specific, in the tone of a newsletter written for one reader. They were also wrong, in several different ways, and I could not tell by reading them. One of them described a holding I had partly sold as having crashed.

This post is about how that got fixed, in the order things broke. Each fix took a job away from the model and gave it to code, until the model was left with one: choosing the words. It no longer writes a single number. Code works out every figure, and formats it the way the reader writes numbers. So far that reader is me, and I write them the Dutch way. A second part, out on DRAFT-DATE, is about running those prompts once they are in production.

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

# A missing value is not zero

My broker does not always report a price. Outside market hours, or for some kinds of asset, the value of a position simply is not there, and the database stores it as missing. The dashboard showed a dash for those fields. The prompt showed `0.00`.

Both read the same row. The difference was one line of Go. Go's database types keep "missing" as a flag next to the number, and the code that wrote the prompt read the number without checking the flag. A missing float is zero. So the page said "I don't know" and the prompt said "nothing", about the same position, on the same day.

The model cannot tell those apart, and it has no reason to try. With test data built to hit the worst case, a known total yesterday and a missing total today, the summary opened like this (numbers invented here, wording as it came back):

> Your portfolio value decreased by 41,300.00 EUR, or 79.40%. Your cash balance of 2,104.90 EUR now represents 100% of your total portfolio value.

Every step of that is correct arithmetic on what it was given.

The fix was to keep "missing" missing all the way into the prompt, and to tell the model what it means:

```go
// money renders a nullable amount for the prompt. Missing is "unknown",
// never 0.00: a zero is a claim the model will build on.
func money(v sql.NullFloat64, currency string) string {
	if !v.Valid {
		return "unknown"
	}
	return fmt.Sprintf("%.2f %s", v.Float64, currency)
}
```

```text
Some values are "unknown": the broker did not report them. Do not compute
a change against an unknown value, do not treat it as zero, and do not
conclude that a position is worthless.
```

The same test case then produced: "The overall change cannot be determined today because the current total value is not available." Less impressive, and true.

Months later the same mistake came back in a different form. The total unrealised profit or loss, the gain on paper across all positions, was zero in every stored snapshot since the first day, and stored as a present value. The "unknown" guard never fired, because nothing claimed to be missing. The code read the broker's *margin* figure, which measures borrowed money, on an account that borrows none. Zero was the right answer to the wrong question.

That one never reached a summary, by luck: the prompt only used each position's own figure, which was right. But it sat in the database for months as a confident zero, waiting for the first chart or alert rule to trust it. The fix was to add the total up from the positions, where the right figure had been all along. If any position's figure is unknown, the total is unknown. An empty list of positions is unknown too, not zero: a flat account and a broker response that came back half empty look the same, and claiming "no gains or losses" when nothing was reported is the expensive mistake.

What I took from this: the model trusts your zeros more than you do. Every value in a prompt is a claim, and the place to decide whether you know something is where the data comes in, not where the prompt is written.

# A sale reported as a crash

One day I sold three quarters of a holding. That evening's summary listed it as the day's biggest loser: its value had dropped by three quarters. The price had moved a fraction of a percent. The dashboard's daily-change column said the same thing.

Go back to the first prompt. Today's lines carried a quantity, yesterday's only a value. With that input, a sale and a price fall are literally the same thing: a smaller number than yesterday. The model was not hallucinating. It was asked a question its data could not answer, and it answered the most likely version of it. The dashboard had the same bug for the same reason, which makes it hard to blame the model.

The obvious fix was to add the quantity to yesterday's lines as well. I nearly did. But that would still leave the model to work out, from raw figures, which part of a change was the market and which part was me. It might do that right most days. I wanted it right every day, and I wanted to be able to test it.

So the movement is now worked out in code, before the prompt is written:

```go
// Market move: the quantity held now, revalued by the price move.
// A sale changes what is held, not what a share did, so this stays
// honest across a partial sale.
move := (now.Price - before.Price) * now.Quantity * fxToBase
```

The change in value is kept as a separate figure, and holdings are ranked by market move only, never by value change. A holding that appeared or disappeared gets an explicit entry instead of a comparison with nothing. And the ranking happens in one currency. Until then, a move in dollars and a move in euros had been compared as plain numbers.

The model now gets a result to describe instead of a puzzle to solve. A holding I partly sold arrives roughly like this (invented numbers):

```text
- ACME: market move down 9.40 EUR. POSITION SIZE CHANGED: sold 90 units.
  This is a purchase or sale, NOT a market movement. Its total value
  fell by 7,412.10 EUR, but only the market move reflects what the
  investment itself did.
- WIDGET: CLOSED this period. The entire holding of 40 units was
  disposed of. This is not a loss and its value did not fall to zero.
```

The capital letters are not elegant, and they work. A sale is described as a sale.

Moving the arithmetic into code paid off right away, because code can be tested and a prompt cannot. "A partial sale is not a price move" became a unit test on real snapshot data. Working out the movement also turned up something no amount of reading summaries had: every price change was exactly zero. The summary ran at eight in the morning, before any market opened, so "today's" price was yesterday's closing price, already stored the night before. Since the first day, the "biggest movers" paragraph had been describing running totals of gains and losses since purchase, and calling them the day's movement. It read fine.

The same shape turned up once more, smaller. The model reasoned about idle cash from two numbers: the total value and the value of the positions. After a sale those do not add up: the proceeds of a trade that has not settled yet sit in neither. It reported cash as a small share of the portfolio while the money from the sale was not counted anywhere. Now code works out that unsettled amount and states it. The prompt says to take cash only from the cash balance, and to say so in one clause when a trade is still settling. When everything has settled, the unsettled amount comes out near zero, which is its own check.

That one is only partly fixed. A deposit or a withdrawal still changes the total value, and at portfolio level I still cannot tell it apart from the market moving. When a holding changed size, the summary now says that part of the change was trading. A deposit with nothing traded would still read as a gain. I know where the data for that is, and I have not done it yet.

# Numbers in a style of their own

Around the same time, the dashboard learned to write amounts the way I do: a point between thousands, a comma before the cents. The summary shown right next to it did not. The dashboard said `52.418,37` and the paragraph beside it said `52418.37 EUR`.

That was not even one consistent style. The model re-typed every figure it was given, in whatever notation it picked that day. One evening it wrote `52,418.37 EUR` and "0.35 percent". The next it wrote `52201.90 EUR`, and a few days later "0.12%". Dutch notation never came up, because nothing told it which notation I read.

The style was the visible part. The worse part was that some figures were never in the prompt at all. The headline percentage, and each holding's share of the portfolio, were left to the model to work out, and it worked them out in prose. Twice it described a holding of just under half the portfolio as "more than half". Nobody checks "more than half" against a calculator. It reads like a fact.

The obvious fix is one more line in the prompt: write numbers the Dutch way. I did not add it, for three reasons.

- **The model would still be doing the arithmetic.** A wrong share written with the right separators is still wrong.
- **The text would be tied to one notation.** A summary is written once, stored, and shown again later. Change the setting, and every summary written before the change keeps the old notation.
- **Nothing could check it.** A test can assert what code returns. It cannot assert which notation a model will choose tomorrow.

This was the sale-as-a-crash problem again, in a smaller form. The model had been given two jobs, choosing the words and handling the numbers, and it was good at only one of them. The previous fix moved the arithmetic out of the prompt. The next step was to move the numbers out of the reply.

# The model writes names, not numbers

The split I ended up with: code decides *what* the figures are and *how* they look, and the model decides only the words around them.

1. Code works out every figure the text may state, including the ones the model used to work out itself, such as the headline percentage and each holding's share. Each figure gets a name.
2. The prompt lists those figures by name. The model writes the name in braces, `{total_today}`, and never the digits.
3. The reply is stored as written, placeholders and all, together with the named values. The stored text does not belong to any notation.
4. Whatever shows the summary, the dashboard or the notification on my phone, fills the placeholders in when it is shown, in the reader's notation, with the same formatting code as the rest of the page.

The prompt still shows the model each value, next to its name. It needs them: it cannot choose between "rose" and "fell", or between "slightly" and "sharply", without knowing the size of the move. It is told to write the name instead of the value:

```text
Every figure you may state is listed below as a placeholder in braces,
followed by its value in parentheses. Write the placeholder exactly as
shown, braces included, and never the value.
Never write a number yourself: nothing you worked out, such as a
difference, a total or a share.

- Total value: {total_today} (52418.37 EUR)
- Change: {change} (431.35 EUR), {change_pct} (0.83%)
```

A reply now looks like "Your portfolio rose by {change} ({change_pct}) to {total_today}", and I read "rose by 431,35 EUR (0,83%) to 52.418,37 EUR". With the setting on English, the same stored sentence reads `52,418.37 EUR`.

<figure class="d2-diagram" role="img" aria-label="Sequence between four parts: app code, the model, the database and the screen. 1: the app sends the model a figure by name with its value, {total_today} (52418.37 EUR). 2: the model replies with the name, rose to {total_today}. 3: the app checks the reply for stray numbers. 4: the app stores the text together with the figures. 5: the screen opens the summary. 6: the app returns the sentence filled in, in the reader's notation: rose to 52.418,37 EUR.">
  <img src="/img/diagrams/model-never-writes-a-number-flow.svg" alt="" />
  <figcaption>The model sees every value but writes only names. Digits appear when the text is shown, in the reader's notation.</figcaption>
</figure>

One detail is easy to get wrong: every figure renders without a sign. Render a loss as a negative number and you get "fell by -9,40 EUR": the model wrote the direction, and the number writes it again. Direction is the job of the prose. So the stored value keeps its sign, because the record should say what happened, and the rendered value is always a magnitude. The prompt says so, because the model can only pick the right verb if it knows the sign will not be there to do it.

The rendering code is small enough to show nearly whole. Trimmed:

```go
type Figure struct {
	Kind     Kind    // Money, Percent or Quantity
	Value    float64 // keeps its sign; always renders as a magnitude
	Currency string
}

var placeholder = regexp.MustCompile(`\{([a-z_]+(?::[A-Za-z0-9._-]+)?)\}`)

// Render fills each {name} in the reader's notation. A name with no
// figure is left as written: shown is more honest than guessed.
func Render(text string, figs map[string]Figure, f Formatter) string {
	return placeholder.ReplaceAllStringFunc(text, func(m string) string {
		fig, ok := figs[m[1:len(m)-1]]
		if !ok {
			return m
		}
		return f.Format(fig.Kind, math.Abs(fig.Value), fig.Currency)
	})
}
```

The optional part after a colon names a figure per holding, such as `{move:ACME}`. `Formatter` is whatever already formats numbers for the reader in the rest of your app. Using that one, not a second copy, means the prose and the table beside it cannot disagree. In my case that meant moving the formatting out of the web layer, where it was tied to the incoming request, because the phone notification is built without one.

When this fails, you can see it. A name the model made up, or a figure that went missing, shows up in the text as `{change}`, in braces. That is ugly, but you notice it, which is more than you could say for "more than half". A value that is not a finite number, the result of dividing by zero for example, is never stored as a figure. It would render as `NaN`, and a figure that does not exist is what the word "unknown" in the prompt is for. Summaries written before any of this have no figures and render as they were stored.

Storing the text without its notation had a side effect I like. When I change the setting, summaries written before the change switch notation too. I watched one stored summary render as `2,500.00` and then, after a reload, as `2.500,00`.

That covers the numbers from my own data. The news explanations quote numbers code cannot know in advance: "crude fell 3.6%", "a target of 68 dollars". For those, the model writes a *literal*: the number inside the placeholder, as `{=3.6%}` or `{=68 USD}`. The notation inside the braces is fixed and strict: a dot for decimals, no grouping, then optionally a scale word such as "billion", then a percent sign or a currency code. That way the value can be read back without guessing whose notation it was written in. It renders per reader like everything else, and keeps the precision of the source: 6% does not become 6.00%.

This still relies on the model following the rule. The prompt says "never write a number". Nothing so far makes sure it doesn't.

# Trust, but check every reply

So every reply is checked before it is stored. It can break the rule in three ways: a number written as digits, a name in braces that is not on the list, or a literal that does not follow the strict notation.

What counts as "a number written as digits" is deliberately narrow: anything with a decimal point or thousands separator, or any number next to a currency or a percent sign. A plain whole number passes. News headlines are full of digits that are neither mine nor figures, such as "Q2 earnings" or "S&P 500", and a check that fired on every summary that mentions the news would soon be ignored. The price is that a stray "12" would get through. Placeholders and literals are removed before the scan, so the digits inside `{=3.6%}` do not count against it.

When a reply breaks the rule, the app asks once more. The retry continues the conversation: the first reply goes back to the model as its own, followed by a message that quotes each violation, such as `"27.73 EUR" is a number you wrote yourself`, and asks for the whole text again. Quoting the number with its currency makes a clearer instruction than the bare digits would.

What happens next, in outline:

```go
first := generate(prompt)
v1 := Validate(first, figs)
if len(v1) == 0 {
	return first, "clean"
}
second, err := generate(prompt, first, v1) // first reply + violations named
if err != nil {
	return first, "retry_failed"
}
v2 := Validate(second, figs)
switch {
case len(v2) == 0:
	return second, "retried_clean"
case len(v2) > len(v1):
	return first, "retried_dirty"
default:
	return second, "retried_dirty"
}
```

There is no third attempt, and no failing the whole report. If the retry is no better, the app keeps whichever reply breaks the rule less, and sends it. A summary with one stray number in it beats no summary. The outcome is stored with every summary and counted in a metric, so a rule that starts slipping shows up as a trend, not as a surprise in one notification.

What the check proves is narrow, and that is the point: every number I read was computed by code and formatted by code. It does not prove the words are right. "Fell" next to a figure that rose would pass. The prompt and the sign rule from the previous section carry that part.

How often it fires, against the real model: the summary test runs two real days of my own data through it, three times each. All six replies were clean on the first attempt. The news explanations were tested on the four articles with the most numbers in them. Once, the model wrote a literal with a sign in it, `{=-2.7%}`, which the strict notation rejects; the retry fixed it. After the prompt said explicitly that literals carry no sign, eight replies out of eight were clean on the first attempt.

Those are small samples. They say the rule is easy for the model to keep, not that it always will be. The retry is a seatbelt, not the mechanism. Without it, the failure is the one this post started with: digits in the model's own style, sent to my phone, unnoticed, because they read fine.

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
