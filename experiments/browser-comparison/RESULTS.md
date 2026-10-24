> **Historical experiment.** Boop now uses Browser Use only. Stagehand is no longer
> installed or active. Previous runners are retained as `.archived` source under
> `experiments/stagehand/archive/`; old npm commands below are historical. See
> [current setup](../../docs/browser-use.md) for supported commands.

# Browser Use vs Stagehand — local results, 24 October 2026

**No clear overall speed or reliability winner in this small trial.** Browser Use was
faster for documentation and used fewer input tokens. Stagehand was faster for the
pricing comparison and JavaScript sandbox. Keep the current Stagehand experiment;
these measurements alone do not justify switching the integration or deploying it.

## Task results

Two trials per task/provider. Mean time until agent completion, excluding cleanup:

| Task | Stagehand | Browser Use | Observed faster provider |
| --- | ---: | ---: | --- |
| Official migration documentation | 24.07 s | 17.70 s | Browser Use |
| Two-provider infrastructure pricing | 18.92 s | 21.14 s | Stagehand |
| JavaScript-only author research (public sandbox) | 9.87 s | 13.59 s | Stagehand |
| All six runs per provider | **17.62 s** | **17.48 s** | Effectively tied |

Both met the defined answer-value, cited-source and captured-evidence checks in
**6/6 runs**. This is observed success on three task types, not a production reliability
rate. No forms, private accounts, purchases or message delivery were tested.

Including browser/process cleanup, the means were **17.70 s Stagehand** and **17.75 s
Browser Use**. The difference is too small relative to task and network variation to
support a speed ranking.

## Individual trials

| Task | Round | Stagehand | Browser Use |
| --- | ---: | ---: | ---: |
| Documentation | 1 | 27.69 s | 15.59 s |
| Documentation | 2 | 20.46 s | 19.81 s |
| Pricing | 1 | 18.66 s | 23.14 s |
| Pricing | 2 | 19.18 s | 19.14 s |
| JavaScript | 1 | 10.04 s | 10.87 s |
| JavaScript | 2 | 9.71 s | 16.31 s |

Round 1 ran Stagehand first, round 2 ran Browser Use first for each task. Fresh browser
profiles were used, but disk/network/model caches can persist. The notable variability
within a task is another reason not to extrapolate these averages.

## Tokens and browser overhead

| Metric, six tasks each | Stagehand | Browser Use |
| --- | ---: | ---: |
| Cumulative input tokens | 78,098 | 44,015 |
| Cached input tokens (subset of above) | 9,344 | 1,024 |
| Output tokens | 1,674 | 1,174 |
| Tool calls | 12 | 11 |
| Mean browser-operation duration | 3.10 s | 4.46 s |

Browser Use used **43.6% fewer cumulative input tokens**, helped by its compact DOM
representation. This does not imply 43.6% lower billing: cache rates differ, output
usage differs, no invoice was measured, and the runtime's zero-dollar estimates are
not billing evidence. Both used the existing ChatGPT allocation, without a separate
browser-service subscription or inference key.

Browser Use's operation timings include Python process/import/IPC overhead and its
DOM watchdogs. Stagehand runs inside the existing Node process. A persistent Python
worker pool could change those numbers. This comparison measures the tested Boop
integration shapes, not isolated protocol performance or native autonomous agents.

## Scoring review

The original raw substring checker flagged both Browser Use pricing runs because
its native representation separated the number `100` and label `browser hours` with
an indexed span and line breaks. The actual page facts and answers were present.

A format-only normalizer was applied **uniformly to every captured result from both
providers**. It decodes tool-output wrappers, removes SDK element markup, collapses
whitespace, and excludes page metadata from content grounding. It adds no facts.
Both libraries then passed all six checks. Original raw scores and traces are retained;
no model calls or answers were changed in this review. Regression tests cover this
formatting issue and ensure a price appearing only in metadata cannot pass.

## Method and limits

- Browser Use **0.13.11**, Stagehand **4.3.0**, Python **3.12.13**, Node **24.14.0**.
- Same `gpt-5.6-sol` model, Boop tool loop, prompts, URLs, four tool contracts,
  14,000-character windows, headless Brave executable and 1280×720 viewport.
- Native SDK page representations intentionally differ, including viewport filtering.
- Task URLs were supplied; search discovery and unrestricted navigation were not tested.
- No screenshots/vision, Stagehand AI act/extract, Browser Use autonomous Agent,
  Browser Use Cloud, bot-evasion service or saved logins were tested.
- No p95, statistical-significance, scale, memory-capacity or universal reliability claim.
- The Browser Use adapter remains an isolated experiment, not a registered server tool.
- Nothing was pushed or deployed.

Run `npm run compare:browsers`, then
`node --import tsx scripts/review-browser-comparison.ts` to regenerate local reports.

Ignored artifacts:
- `data/browser-use/comparison/results.json`: original results, page evidence and scores.
- `data/browser-use/comparison/reviewed-results.json`: normalized grounding review and summary.
- `data/browser-use/comparison/*.log`: local SDK worker logs.

Source pages read by the actual agents:
- https://docs.stagehand.dev/v4/migrations/playwright
- https://www.browserbase.com/pricing
- https://browser-use.com/pricing
- https://quotes.toscrape.com/js/
