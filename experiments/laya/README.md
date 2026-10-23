# Laya experiment for Boop

Measured findings: [RESULTS.md](RESULTS.md).

This is an isolated local benchmark, not an enabled production router. Fixtures
are synthetic; predictions never invoke Composio, read a real inbox, send a
message, or change an external record.

## Run

Requires Python 3.12 and uv. From the repository root:

```sh
uv venv --python 3.12 data/laya/.venv
uv pip install --python data/laya/.venv/bin/python -r experiments/laya/requirements.lock.txt
npm run test:laya -- --model english --device cpu --threads 2
npm run test:laya -- --model multilingual --device cpu --threads 2
# Optional Apple Silicon comparison:
npm run test:laya -- --model english --device mps --threads 2
npm run test:laya -- --model multilingual --device mps --threads 2
```

The first run downloads the selected checkpoint into ignored data/laya/.
HTTP downloads are used by default; set HF_HUB_DISABLE_XET=0 to opt into Xet.
No paid inference key is needed. Allow space for Python dependencies and model
weights. The lock file records packages tested on macOS arm64; another operating
system may need a different PyTorch build.

## Measurements

- Seven-way task routing plus a diagnostic yes/no external-write question.
- 28 English examples; multilingual also includes four Hindi and four Telugu
  examples. Labels and questions were written before inference.
- Three timed predictions per example after two warm-ups; median and p95 latency.
- Repeat consistency, per-language accuracy, and errors at an illustrative fixed
  0.8 answer-confidence threshold, not tuned on these examples.
- Checkpoint load time (including download/cache loading, excluding imports) and
  first-inference time separately. Warm timing excludes both.
- Process RSS sampled after predictions, which can miss transient peaks. MPS also
  reports device allocations, not directly comparable or necessarily additive to
  RSS on unified memory.
- Model revision, dependency versions, fixture/schema hashes, and raw predictions
  in data/laya/<model>-<device>.json. Separate long-input probes put a task before
  and after padding to expose truncation; they are excluded from short-message accuracy.

Options: --repeats, --revision, --output. A two-thread CPU limit constrains this
experiment; it does not simulate our AWS instance's hardware or workload.

## Interpretation

This small synthetic fixture is exploratory, not a calibrated production test.
The write classifier must never replace existing approval/authorization checks.
Confidence is not proof of correctness. Deployment needs a larger held-out set,
contextual requests, language coverage, and comparison with the current dispatcher.

Keep Laya outside the critical path until routing quality and resource use justify
integration. Classification time cannot predict complete task latency through
external providers. This experiment does not change AWS configuration.

Upstream: https://github.com/NandhaKishorM/laya and
https://huggingface.co/convaiinnovations/laya (Apache-2.0).
