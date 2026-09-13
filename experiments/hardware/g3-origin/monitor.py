#!/usr/bin/env python3
"""Bounded author command runner; output, deadlines and task storage are monitored."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1048576), b""):
            h.update(block)
    return h.hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--receipt", required=True)
    p.add_argument("--seconds", required=True, type=int)
    p.add_argument("--container")
    p.add_argument("--watch", action="append", default=[])
    p.add_argument("argv", nargs=argparse.REMAINDER)
    a = p.parse_args()
    argv = a.argv[1:] if a.argv[0] == "--" else a.argv
    out = Path(a.receipt)
    out.parent.mkdir(parents=True, exist_ok=True)
    log = out.with_suffix(".log")
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    start = time.monotonic()
    receipt = dict(argv=argv, cwd=os.getcwd(), started=started, pid=os.getpid(),
                   secondsLimit=a.seconds, logLimitBytes=16*1024*1024,
                   watchLimits=a.watch, storageEnforcement="monitored, not hard quota")
    out.with_suffix(".running.json").write_text(json.dumps(receipt, indent=2)+"\n")
    event = None
    event_log = None
    if a.container:
        # --since supplies replay if daemon subscription races with start.
        event_log = out.with_suffix(".events.jsonl").open("wb")
        event = subprocess.Popen(["docker", "events", "--since", started,
                                  "--filter", "container="+a.container,
                                  "--format", "{{json .}}"], stdout=event_log, stderr=subprocess.STDOUT)
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            start_new_session=True)
    selector = selectors.DefaultSelector()
    assert proc.stdout is not None
    selector.register(proc.stdout, selectors.EVENT_READ)
    total = 0
    reason = None
    samples = []
    next_measure = start
    terminated = None
    peak = {}
    with log.open("wb") as f:
        while selector.get_map() or proc.poll() is None:
            now = time.monotonic()
            if now-start > a.seconds and reason is None:
                reason = "deadline"
            if now >= next_measure:
                next_measure = now + 10
                sample: dict[str, object] = {"elapsedSeconds": now-start}
                for spec in a.watch:
                    directory, limit = spec.rsplit(":", 1)
                    r = subprocess.run(["du", "-sk", directory], capture_output=True, timeout=30)
                    if r.returncode != 0:
                        reason = "storage-monitor-failed"
                        sample[directory] = r.stderr.decode(errors="replace")
                    else:
                        n = int(r.stdout.split()[0])*1024
                        sample[directory] = n
                        peak[directory] = max(peak.get(directory, 0), n)
                        if n > int(limit):
                            reason = "storage-budget"
                if a.container:
                    r = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}", a.container],
                                       capture_output=True, timeout=30)
                    sample["dockerStats"] = r.stdout.decode(errors="replace")
                    sample["dockerStatsExit"] = r.returncode
                samples.append(sample)
            if reason is not None and terminated is None:
                terminated = now
                if a.container:
                    r = subprocess.run(["docker", "stop", "--time", "10", a.container], capture_output=True, timeout=30)
                    receipt["containerStop"] = dict(exit=r.returncode, output=r.stdout.decode(errors="replace"), stderr=r.stderr.decode(errors="replace"))
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGTERM)
            if terminated is not None and now-terminated > 15 and proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
            for key, _ in selector.select(timeout=1):
                block = os.read(key.fd, 65536)
                if not block:
                    selector.unregister(key.fileobj)
                    continue
                remaining = receipt["logLimitBytes"]-total
                f.write(block[:max(0,remaining)])
                total += len(block)
                if total > receipt["logLimitBytes"]:
                    reason = "required-log-truncated"
    code = proc.wait(timeout=30)
    if event:
        event.terminate()
        event.wait(timeout=30)
        assert event_log is not None
        event_log.close()
        r = subprocess.run(["docker", "inspect", a.container], capture_output=True, timeout=30)
        receipt["containerInspectExit"] = r.returncode
        receipt["containerInspect"] = json.loads(r.stdout) if r.returncode == 0 else r.stderr.decode(errors="replace")
    receipt.update(exit=code, reason=reason, elapsedSeconds=time.monotonic()-start,
                   finished=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   outputBytes=total, completeLog=total <= receipt["logLimitBytes"],
                   logSha256=sha(log), samples=samples, peakDirectoryBytes=peak)
    out.write_text(json.dumps(receipt, indent=2)+"\n")
    print(json.dumps({k: receipt[k] for k in ("exit", "reason", "elapsedSeconds", "completeLog")}))
    return 0 if code == 0 and reason is None else 1


if __name__ == "__main__":
    raise SystemExit(main())
