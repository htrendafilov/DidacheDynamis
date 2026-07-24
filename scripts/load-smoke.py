#!/usr/bin/env python3
"""Small dependency-free HTTP load smoke for the read-only passage API."""

from __future__ import annotations

import argparse
import math
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="origin, e.g. http://127.0.0.1:8080")
    parser.add_argument(
        "--path",
        default="/api/v1/works/web/passage/John/3",
        help="read-only endpoint to exercise",
    )
    parser.add_argument("--concurrency", type=int, default=100)
    parser.add_argument("--requests", type=int, default=1000)
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("--max-error-rate", type=float, default=0.01)
    parser.add_argument("--max-p95-ms", type=float, default=500)
    return parser.parse_args()


def percentile(values: list[float], fraction: float) -> float:
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def main() -> int:
    args = parse_args()
    if args.concurrency <= 0 or args.requests < args.concurrency:
        raise SystemExit("--requests must be at least --concurrency, and both must be positive")
    target = urljoin(args.url.rstrip("/") + "/", args.path.lstrip("/"))
    barrier = threading.Barrier(args.concurrency)
    base, remainder = divmod(args.requests, args.concurrency)

    def worker(index: int) -> tuple[list[float], int]:
        count = base + (1 if index < remainder else 0)
        latencies: list[float] = []
        errors = 0
        barrier.wait()
        for _ in range(count):
            started = time.perf_counter()
            try:
                request = urllib.request.Request(target, headers={"Accept": "application/json"})
                with urllib.request.urlopen(request, timeout=args.timeout) as response:
                    response.read()
                    if response.status != 200:
                        errors += 1
            except (OSError, urllib.error.URLError):
                errors += 1
            latencies.append((time.perf_counter() - started) * 1000)
        return latencies, errors

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        results = list(pool.map(worker, range(args.concurrency)))
    elapsed = time.perf_counter() - started
    latencies = [latency for worker_latencies, _ in results for latency in worker_latencies]
    errors = sum(error_count for _, error_count in results)
    error_rate = errors / args.requests
    p50 = statistics.median(latencies)
    p95 = percentile(latencies, 0.95)
    rate = args.requests / elapsed

    print(
        f"requests={args.requests} concurrency={args.concurrency} errors={errors} "
        f"error_rate={error_rate:.3%} p50_ms={p50:.1f} p95_ms={p95:.1f} "
        f"requests_per_second={rate:.1f}"
    )
    if error_rate > args.max_error_rate:
        print(
            f"FAILED: error rate exceeds {args.max_error_rate:.3%}",
            file=sys.stderr,
        )
        return 1
    if p95 > args.max_p95_ms:
        print(f"FAILED: p95 exceeds {args.max_p95_ms:.1f} ms", file=sys.stderr)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
