> **Historical experiment.** Boop now uses Browser Use only. Stagehand is no longer
> installed or active. Previous runners are retained as `.archived` source under
> `experiments/stagehand/archive/`; old npm commands below are historical. See
> [current setup](../../docs/browser-use.md) for supported commands.

# Browser Use vs Stagehand: local Boop integration comparison

This experiment compares **Browser Use 0.13.11** and **Stagehand 4.3.0** as the browser
reading layer inside the **same Boop OpenAI agent loop**. It is not a comparison of
the fully autonomous Browser Use agent, Browser Use Cloud, Stagehand's AI `act` or
`extract` methods, or provider marketing benchmarks.

Both providers receive the same model, system/task prompts, source URLs, four tool
contracts, 14,000-character snapshot windows, existing context compaction, headless
Brave executable, and 1280×720 viewport. Profiles are fresh for each task. Native
page representations differ: Stagehand's accessibility tree vs Browser Use's DOM
serializer. That difference is part of the capability being evaluated.

Two trials per task/provider, provider order reversed on trial two: **12 model tasks**.
Tasks are the same as the earlier research test:

- Official Stagehand/Playwright migration research.
- Two-provider browser infrastructure pricing comparison.
- First three displayed author names on the public Quotes to Scrape JavaScript sandbox.

No quotation text is requested. No logins, messages, submissions, cloud-browser keys
or paid browser services are involved. Model calls use Boop's existing connection
and consume its allocation. Runtime zero-dollar estimates do not establish free
inference or measured billing. No credentials are passed to the Python worker.

## Setup (local macOS)

Node >=22.18 and Python 3.12, plus the installed Brave browser used in the Stagehand
trial. Browser Use is isolated from the project's normal runtime dependencies:

```sh
uv venv --python 3.12 data/browser-use/venv
uv pip install --python data/browser-use/venv/bin/python -r experiments/browser-comparison/requirements.macos-arm64.lock
npm run compare:browsers
```

`requirements.txt` pins the tested Browser Use release. The full lock is the tested
macOS/ARM64 dependency set; it contains platform-specific packages and is not an AWS
Linux deployment lock. No global Python packages or separate model keys are needed.
Set `BOOP_STAGEHAND_EXECUTABLE_PATH` if Brave is installed elsewhere. The benchmark
uses Brave for both providers so browser choice does not confound results.

## Implementation and boundaries

- `worker.py`: Browser Use SDK only, local fresh profiles, allowed source domains,
  screenshots off, cloud off, default extensions off, anonymous telemetry disabled.
- `scripts/browser-use-test-adapter.ts`: private JSON-line stdio bridge, exact-origin
  URL validation and public-address checking; same four read-only tools as Stagehand.
- `scripts/compare-browser-libraries.ts`: counterbalanced trials and captured evidence.
- `scripts/browser-research-cases.ts`: shared tasks with the earlier research harness.

Browser Use's startup time includes a new Python subprocess, imports, IPC and DOM
watchdogs; Stagehand's SDK runs in the existing Node process. This is the actual
integration shape being tested, not a claim about pure CDP latency. A persistent
Python worker pool could change results. Agent latency and cleanup-inclusive latency
are reported separately. Browser-operation durations include library startup.

The raw SDK DOM states can differ in viewport filtering and serialization. Both
adapters deliberately expose only the current local research tool contract; native
scrolling, autonomous planning, saved logins and form filling are outside this test.
Failures require examining returned evidence before attributing them to either SDK.
Browser Use's domain policy is not a replacement for network egress isolation.

Public-site content, network latency, model randomness and caching may vary between
runs. Two trials per task cannot establish production reliability, p95, or a universal
speed ranking. The task prompts supply URLs; search discovery is not evaluated.

Reports and public-page evidence are stored under ignored
`data/browser-use/comparison/`. Worker logs contain no model credentials. This
experiment is not registered on server/customer routes, and nothing is deployed.

References:
- https://github.com/browser-use/browser-use
- https://docs.browser-use.com/llms.txt
- https://docs.stagehand.dev/v4/integrations/agent-frameworks/overview
