# Laya benchmark — 2026-10-23

Ran real checkpoint inference locally on an Apple M4 with 16 GiB unified memory.
Laya 0.4.13, PyTorch 2.14.1, Python 3.12.13. CPU runs used two PyTorch threads.
Each request asked two questions: seven-way task routing and an external-write
diagnostic. No paid inference API or private account data was used.

| Checkpoint / backend | Unique requests | Correct routes | Warm median | Warm p95 |
| --- | ---: | ---: | ---: | ---: |
| English / CPU | 28 | 13/28 (46.4%) | 448 ms | 505 ms |
| English / Apple GPU (MPS) | 28 | 13/28 (46.4%) | 432 ms | 490 ms |
| Multilingual / CPU | 36 | 24/36 (66.7%) | 163 ms | 193 ms |
| Multilingual / Apple GPU (MPS) | 36 | 24/36 (66.7%) | 147 ms | 211 ms |

All repeated classifications were consistent across three predictions per request.
Repeats are timing samples, not additional independent accuracy examples. On the
same 28 English requests, multilingual scored 19/28; Hindi scored 3/4 and Telugu
2/4. These tiny language samples do not establish general language accuracy.

## Resource use

Observed CPU process RSS peaked at 1,919 MiB for English and 1,485 MiB for
multilingual, including the long-input probes. Sampling can miss transient peaks.
The GPU runs reported 1,610/1,236 MiB of MPS tensor allocations and
2,071/2,410 MiB of driver allocations, respectively. Low GPU-process RSS does not
mean the model uses little memory: MPS uses unified memory, and these figures
are not necessarily additive.

Weights were prefetched and checked against the pinned Hugging Face SHA-256
digests. Network download time is excluded from warm timing. Loading, imports,
and first inference add startup overhead. Downloading the other checkpoint
overlapped the English runs; this was an exploratory desktop measurement, not
a dedicated-server benchmark. Do not extrapolate the timing to AWS.

## Reliability findings

- At the preselected 0.8 route-confidence threshold, English accepted 9/28 and
  got all nine correct. That small subset does not validate a production threshold.
- Multilingual accepted 19/36 at that threshold and got 17/19 correct. It confused
  two water reminders with memory requests at confidence 0.9672 and 0.9715.
- English missed one of three external-write requests and produced two false
  positives. Multilingual missed all three and produced two false positives.
  Neither diagnostic is suitable as an authorization mechanism. Its accuracy
  is affected by the predominantly non-write fixture; confusion counts and
  majority baselines are included in the JSON reports.
- Both models truncated the long-input probes. The English model selected email
  with the request at the start but calendar with the same request at the end.
  Multilingual selected other in both cases. Check truncation explicitly in any
  future integration; do not pass an entire conversation and assume it was read.

## Decision

Keep Boop's existing dispatcher. Multilingual is the more promising checkpoint
to investigate, but neither base checkpoint is accurate enough for automatic
routing in this experiment. Before enabling one, collect a larger separate
development/evaluation set, improve or fine-tune the decision schema, validate
fallback policy on held-out requests, and measure the target host's memory.
Never train on these evaluation rows and report the resulting score as held-out
accuracy. Confidence or routing must never bypass existing approval checks.

A future integration would need a resident model service; launching this
benchmark CLI for every incoming message would repeatedly pay import/load costs.
Classification speed does not remove external provider/tool execution delays.

## Reproduce

See [README.md](README.md) for setup and commands. Per-request predictions, timing samples,
model revision, dependency versions, and fixture/schema hashes are in [results/](results/).
English baseline/confusion metrics were derived from the saved predictions after
inference; no labels, questions, predictions, or confidence threshold were tuned.
This experiment does not enable Laya in Boop or change the AWS deployment.
