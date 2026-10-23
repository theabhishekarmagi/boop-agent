"""Offline synthetic Boop routing benchmark; never executes the selected action."""
import argparse
from collections import Counter
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import statistics
import time

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / "data/laya/huggingface"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=["english", "multilingual"], default="english")
    parser.add_argument("--device", choices=["cpu", "mps"], default="cpu")
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--revision", default="7b928d828b7b0e022f929d9bd2e44165aa270148")
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.repeats < 1 or args.threads < 1:
        parser.error("repeats and threads must be positive")

    import psutil
    import torch
    import laya

    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    if args.device == "mps" and not torch.backends.mps.is_available():
        parser.error("MPS is unavailable; choose --device cpu")
    cases_path = ROOT / "experiments/laya/cases.json"
    questions_path = ROOT / "experiments/laya/questions.json"
    cases = json.loads(cases_path.read_text())
    # The English checkpoint isn't intended to handle Hindi and Telugu.
    if args.model == "english":
        cases = [case for case in cases if case["language"] == "en"]
    questions = json.loads(questions_path.read_text())
    process = psutil.Process()
    before_rss = process.memory_info().rss
    started = time.perf_counter()
    print(f"Loading {args.model} on {args.device}, {args.threads} CPU threads...", flush=True)
    agent = laya.load("convaiinnovations/laya", device=args.device, revision=args.revision,
                      subfolder="multilingual" if args.model == "multilingual" else None)
    load_seconds = time.perf_counter() - started
    if str(agent.device).split(":")[0] != args.device:
        raise RuntimeError(f"Backend unexpectedly fell back to {agent.device}")

    def sync():
        if args.device == "mps":
            torch.mps.synchronize()

    sync()
    first = time.perf_counter()
    agent.predict("Hello Boop", questions)
    sync()
    first_ms = (time.perf_counter() - first) * 1000
    agent.predict("Find the unread email from yesterday.", questions)
    sync()
    peak_rss = process.memory_info().rss
    rows = []
    all_ms = []
    for case in cases:
        predictions, durations = [], []
        for _ in range(args.repeats):
            sync()
            start = time.perf_counter()
            result = agent.predict(case["text"], questions)
            sync()
            durations.append((time.perf_counter() - start) * 1000)
            predictions.append(result)
            peak_rss = max(peak_rss, process.memory_info().rss)
        answers = predictions[0]["answers"]
        route = answers["route"]["choice"]
        write = answers["external_write"]["noul"] >= 0.5
        consistent = all(p["answers"]["route"]["choice"] == route and
                         (p["answers"]["external_write"]["noul"] >= 0.5) == write for p in predictions)
        row = {**case, "predicted_route": route, "route_correct": route == case["route"],
               "predicted_external_write": write, "write_correct": write == case["external_write"],
               "route_answer_confidence": answers["route"]["answer_confidence"],
               "write_probability": answers["external_write"]["noul"],
               "repeat_consistent": consistent, "latency_ms": durations,
               "usage": predictions[0].get("usage", {})}
        rows.append(row)
        all_ms.extend(durations)
        print(f"{case['id']}: {route} expected={case['route']} median={statistics.median(durations):.1f}ms", flush=True)

    # Separate robustness probes; not included in the short-message accuracy.
    probes = []
    request = "Please summarize my unread emails from today."
    padding = "Background note with no requested action. " * 300
    for position, text in [("head", request + " " + padding), ("tail", padding + " " + request)]:
        result = agent.predict(text, questions)
        sync()
        peak_rss = max(peak_rss, process.memory_info().rss)
        probes.append({"request_position": position, "expected_route": "email",
                       "predicted_route": result["answers"]["route"]["choice"],
                       "usage": result.get("usage", {})})

    def accuracy(items, field):
        return sum(row[field] for row in items) / len(items) if items else None

    sorted_ms = sorted(all_ms)
    accepted = [row for row in rows if row["route_answer_confidence"] >= 0.8]
    positives = sum(row["external_write"] for row in rows)
    confusion = {name: sum(row["external_write"] == truth and row["predicted_external_write"] == predicted for row in rows)
                 for name, truth, predicted in [("tp", True, True), ("fn", True, False),
                                                 ("fp", False, True), ("tn", False, False)]}
    summary = {
        "route_majority_baseline": max(Counter(row["route"] for row in rows).values()) / len(rows),
        "write_majority_baseline": max(positives, len(rows) - positives) / len(rows),
        "write_confusion": confusion,
        "write_recall": confusion["tp"] / positives if positives else None,
        "cases": len(rows), "route_accuracy": accuracy(rows, "route_correct"),
        "write_accuracy": accuracy(rows, "write_correct"),
        "repeat_consistent": all(row["repeat_consistent"] for row in rows),
        "warm_median_ms": statistics.median(all_ms), "warm_p95_ms": sorted_ms[math.ceil(.95 * len(sorted_ms)) - 1],
        "load_seconds_including_cache_or_download": load_seconds, "first_inference_ms": first_ms,
        "baseline_rss_mib": before_rss / 2**20, "observed_peak_rss_mib": peak_rss / 2**20,
        "incremental_observed_rss_mib": (peak_rss - before_rss) / 2**20,
        "high_confidence_0_8": {"coverage": len(accepted) / len(rows), "count": len(accepted),
                                  "route_accuracy": accuracy(accepted, "route_correct")},
        "by_language": {lang: {"cases": len(group := [r for r in rows if r["language"] == lang]),
                               "route_accuracy": accuracy(group, "route_correct")}
                        for lang in sorted(set(row["language"] for row in rows))},
    }
    if args.device == "mps":
        summary["mps_allocated_mib"] = torch.mps.current_allocated_memory() / 2**20
        summary["mps_driver_allocated_mib"] = torch.mps.driver_allocated_memory() / 2**20
    report = {
        "settings": vars(args), "hardware": {"system": platform.platform(), "machine": platform.machine(),
                                               "cpu_count": os.cpu_count(), "processor": platform.processor(), "ram_gib": psutil.virtual_memory().total / 2**30},
        "versions": {name: importlib.metadata.version(name) for name in ["laya", "torch", "transformers", "psutil"]},
        "dataset_sha256": hashlib.sha256(cases_path.read_bytes()).hexdigest(),
        "questions_sha256": hashlib.sha256(questions_path.read_bytes()).hexdigest(),
        "summary": summary, "cases": rows, "long_input_probes": probes,
        "limitations": ["Small synthetic exploratory dataset, not production accuracy or calibrated confidence.",
                         "Mac results do not predict latency or total RAM use on AWS.",
                         "Observed RSS samples can miss transient peaks; MPS memory reported separately.",
                         "The external_write question is a diagnostic, never an authorization mechanism."]}
    output = Path(args.output) if args.output else ROOT / f"data/laya/{args.model}-{args.device}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, indent=2), flush=True)
    print(f"Report: {output}", flush=True)


if __name__ == "__main__":
    main()
