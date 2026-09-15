"""Fast regression test for the four pre-validated judging scenarios."""
from app import DEMO_PROFILES, simulator

for fault, profile in DEMO_PROFILES.items():
    branch = profile["branch"]
    simulator.reset()
    simulator.inject_profile(fault)
    sequence = []
    for _ in range(12):
        simulator.last_update = 0.0
        r = simulator.snapshot()["branches"][branch]
        sequence.append((r["status"], r["fault_type"], r["anomaly_score"]))
    reached_danger = any(s == "danger" for s, _, _ in sequence)
    diagnosed = any(s == "danger" and d == fault for s, d, _ in sequence)
    print(f"{fault:14s} @ {branch:14s} danger={reached_danger} diagnosed={diagnosed} final={sequence[-1]}")
    assert reached_danger, (fault, sequence)
    assert diagnosed, (fault, sequence)
print("ALL DEMO SCENARIOS PASSED")
