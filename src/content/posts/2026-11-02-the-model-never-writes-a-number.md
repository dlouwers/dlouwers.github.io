---
title: "The model never writes a number, part 1: questions the data could not answer"
date: 2026-11-02
summary: "I let an LLM write a daily summary of my investment portfolio. It read well, and was wrong in ways I could not see by reading it. Part one: a missing value shown as zero, a sale reported as a crash, and why neither was the model's fault."
tags: [llm, go]
cover: /img/posts/model-never-writes-a-number/cover.png
coverAlt: "Isometric illustration on a dark navy grid. On the left, a machine with brass gears behind glass takes in a stack of dark blocks and sets out a row of glowing teal tiles. In the centre, a glowing orb shines a beam onto an unrolled scroll of wavy lines with empty slots outlined in orange. On the right, a phone and a monitor show the same kind of page with teal tiles in the slots."
draft: false
---

# A summary that read well

I have a small app that watches my brokerage account. Every few minutes it records what I hold and what it is worth, and once a day it sends a notification to my phone: a few paragraphs, written by a large language model, about what changed.

The first summaries were a pleasure to read. Calm, specific, in the tone of a newsletter written for one reader. They were also wrong, in several different ways, and I could not tell by reading them. One of them described a holding I had partly sold as having crashed.

This series is about how that got fixed, in the order things broke. Each fix took a job away from the model and gave it to code, until the model was left with one: choosing the words. It no longer writes a single number.

This first part is about the failures that came from what the model was given: a missing value shown as zero, and a sale that looked like a crash. Part two, out on 9 November, is about how the model stopped writing numbers at all, so that code formats every figure the way the reader writes them. So far that reader is me, and I write them the Dutch way. Part three is about running these prompts once they are in production.

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

# What these failures have in common

None of them was a hallucination in the usual sense. Each time, the model gave a sensible answer to the question its input actually asked: a zero is a zero, and a smaller value than yesterday is a fall. The mistakes were in my data and in my question. The model wrote them up so well that I did not notice.

The fixes had a common shape too. Something the model had been left to infer, code now works out and states: unknown is unknown, a sale is a sale, money that has not settled is named as such. And each of those could then be tested, which a prompt cannot.

That left the model choosing which facts to mention and how to say them, plus one job it should never have had: typing the numbers. It did that in a style of its own, and now and then it did a sum of its own on the way. Part two, out on 9 November, takes that job away as well. The model writes names in place of numbers, code fills them in the way the reader writes them, and every reply is checked before it is sent.
