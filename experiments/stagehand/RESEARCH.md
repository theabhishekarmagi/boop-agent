> **Historical experiment.** Boop now uses Browser Use only. Stagehand is no longer
> installed or active. Previous runners are retained as `.archived` source under
> `experiments/stagehand/archive/`; old npm commands below are historical. See
> [current setup](../../docs/browser-use.md) for supported commands.

# Live public research results — 24 October 2026

**Recommendation: retain Stagehand as an optional research capability, not a general
speed optimization.** Two real research tasks and one public JavaScript sandbox task
were run through both Boop's existing WebFetch and actual Stagehand browser tools.
The local configured model was `gpt-5.6-sol`, using the existing ChatGPT connection.

| Task | Existing WebFetch | Stagehand first run | Result |
| --- | ---: | ---: | --- |
| Research Stagehand/Playwright migration constraints | 11.9 s | 30.2 s | Both returned the expected compatibility facts and sources |
| Compare two providers for 50 browser hours/month | 13.3 s | 40.6 s | Both returned correct numbers; browser made unnecessary retries; stricter browser follow-up passed in 21.6 s |
| Identify the first three displayed authors on a JavaScript-only page | 11.1 s, unavailable | 14.1 s, completed | Fetch honestly returned no authors; browser read the rendered names correctly |

The JavaScript page is the public Quotes to Scrape **sandbox**, not a production
customer portal. Author order was independently verified against its embedded data
without passing the expected names to the model. No quotation text was requested.

## What happened

- Documentation: WebFetch used one tool call. Browser used three: it opened HTML,
  opened the markdown copy, then read another snapshot chunk. Browser operations
  themselves totalled **4.9 s**; the complete task took **30.2 s**.
- Pricing: WebFetch used two calls. The initial browser run used six calls including
  cosmetic URL retries and a result lookup. Browser operations totalled **3.4 s**,
  far below the **40.6 s** total. Extra model/tool rounds dominated elapsed time.
- JavaScript: plain fetch strips scripts and cannot see the rendered author data.
  It correctly reported that limitation. Browser opened the page and closed the tab,
  with **3.3 s** of browser operations inside the **14.1 s** total.

For the two static-source tasks, the initial browser runs were approximately 2.5× and
3.1× slower. Those ratios describe these individual trials, not a general benchmark.

## Evidence review and follow-up

The initial harness checked answer values, source citations and URL coverage. Its
pricing validation did not retain the full original page output, so correct numbers
alone were insufficient to certify grounding. A follow-up captured tool evidence and
required the Developer Plan, $20 price, 100 included browser hours, and 0.02 hourly
rate to actually appear in returned content. That stricter follow-up **passed**.

With guidance to read an empty/loading tab once instead of opening cosmetic URL
variants, the follow-up used **three calls**, took **21.6 s**, and consumed **14,977**
input tokens instead of the first browser run's **23,348**. Browser operations totalled
**2.8 s**. This is a single follow-up with changed instructions and network/cache
variation; it does not isolate or prove a universal optimization effect.

The retry guidance was added to the shared browser instructions. No navigation
permissions, customer exposure or production deployment settings were broadened.

## Token usage

Input tokens are cumulative over agent turns, not unique page tokens.

| Task | Fetch input/output tokens | Browser input/output tokens, initial run |
| --- | ---: | ---: |
| Documentation | 4,938 / 227 | 26,954 / 583 |
| Pricing | 5,475 / 163 | 23,348 / 763 |
| JavaScript | 1,362 / 77 | 6,464 / 121 |

The runtime reports a zero dollar estimate for this connection/model. That does not
measure billing or establish free inference; runs consume the connected ChatGPT
account's allocation. No managed-browser subscription or separate inference service
was used.

## Boundaries and reproducibility

- One initial run per task/method, six initial model tasks, plus one pricing follow-up.
- Same model; source URLs supplied to both methods. Search discovery was not tested.
- Fetch ran first, then browser. Cold browser profiles do not remove all network or
  provider caching effects. No statistical significance or p95 claim is made.
- Answers were checked against current official pages. The follow-up retained raw
  tool evidence locally; original initial runs retained call traces and metrics.
- No account logins, user email, outgoing messages, forms or purchases were involved.
- This exercises Stagehand's deterministic browser tools through Boop's own model,
  not Stagehand's separate AI `act`/`extract` features or a competitor browser SDK.
- Nothing was pushed or deployed. Browser remains local/operator-only.

Run `npm run research:stagehand` to repeat all six tasks. To repeat only the stricter
pricing browser task:

```sh
npm run research:stagehand -- --task=provider-cost-research --mode=browser
```

Ignored raw reports:
- `data/stagehand/research-results.json`: six original runs.
- `data/stagehand/research-followup.json`: stricter pricing follow-up and tool evidence.
- `data/stagehand/pricing-probe.json`: independent browser page-reading diagnosis.

Sources read by the test agents:
- https://docs.stagehand.dev/v4/migrations/playwright
- https://www.browserbase.com/pricing
- https://browser-use.com/pricing
- https://quotes.toscrape.com/js/
