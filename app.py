"""HARIS live prototype backend using virtual readings + saved Isolation Forest models."""
from __future__ import annotations

import json
import random
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from haris_core import BRANCHES, FAULT_TYPES, VOLTAGE_MEAN, diagnose_values

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models"
STATIC_DIR = ROOT / "static"
FEATURES = ["voltage", "current", "temperature"]


def ensure_models() -> None:
    needed = [MODEL_DIR / f"{b}_isolation_forest.joblib" for b in BRANCHES]
    needed += [MODEL_DIR / f"{b}_baseline.json" for b in BRANCHES]
    needed += [MODEL_DIR / "metrics.json", MODEL_DIR / "demo_fault_profiles.json"]
    if not all(p.exists() for p in needed):
        from train_models import train_all
        train_all(save_csv=False)


ensure_models()

def load_assets():
    try:
        models = {b: joblib.load(MODEL_DIR / f"{b}_isolation_forest.joblib") for b in BRANCHES}
    except Exception:
        # A model serialized by a different scikit-learn version may fail to
        # load. Rebuild locally from the reproducible virtual-data script.
        from train_models import train_all
        train_all(save_csv=False)
        models = {b: joblib.load(MODEL_DIR / f"{b}_isolation_forest.joblib") for b in BRANCHES}

    baselines = {}
    for branch in BRANCHES:
        with open(MODEL_DIR / f"{branch}_baseline.json", encoding="utf-8") as f:
            baselines[branch] = json.load(f)
    with open(MODEL_DIR / "metrics.json", encoding="utf-8") as f:
        metrics = json.load(f)
    with open(MODEL_DIR / "demo_fault_profiles.json", encoding="utf-8") as f:
        profiles = json.load(f)
    return models, baselines, metrics, profiles

MODELS, BASELINES, VALIDATION_METRICS, DEMO_PROFILES = load_assets()


class VirtualGrid:
    """Four smoothly changing virtual sensors with optional synthetic fault scenarios."""

    def __init__(self, seed: int = 2026):
        self.rng = random.Random(seed)
        self.lock = threading.RLock()
        self.history = {b: deque(maxlen=120) for b in BRANCHES}
        self.events = deque(maxlen=80)
        self.alert_state = {b: {"status": "normal", "fault_type": "none"} for b in BRANCHES}
        self.event_sequence = 0
        self.base_readings: Dict[str, dict] = {}
        self.active_faults: Dict[str, Optional[dict]] = {b: None for b in BRANCHES}
        self.sequence = 0
        self.last_update = 0.0
        self.latest: Dict[str, dict] = {}
        self._reset_base()
        self._update(force=True)

    def _expected(self, branch: str) -> tuple[float, float, float]:
        cfg = BRANCHES[branch]
        is_day = 8 <= datetime.now().hour < 20
        current = cfg["current_day"] if is_day else cfg["current_night"]
        temperature = cfg["temp_day"] if is_day else cfg["temp_night"]
        return VOLTAGE_MEAN, current, temperature

    def _reset_base(self) -> None:
        for branch in BRANCHES:
            v, c, t = self._expected(branch)
            self.base_readings[branch] = {
                "voltage": v + self.rng.gauss(0, 0.6),
                "current": max(0.05, c + self.rng.gauss(0, BRANCHES[branch]["current_std"] * 0.15)),
                "temperature": t + self.rng.gauss(0, BRANCHES[branch]["temp_std"] * 0.15),
            }

    def reset(self) -> None:
        with self.lock:
            self.active_faults = {b: None for b in BRANCHES}
            self.events.clear()
            self.alert_state = {b: {"status": "normal", "fault_type": "none"} for b in BRANCHES}
            self.event_sequence = 0
            self._reset_base()
            self.last_update = 0.0

    @staticmethod
    def _strength(step: int, duration: int) -> float:
        # ramp for 6 readings -> hold -> recover for 6 readings
        if step < 6:
            return (step + 1) / 6.0
        if step < duration - 6:
            return 1.0
        return max(0.0, (duration - step) / 6.0)

    def inject_profile(self, fault_type: str) -> str:
        if fault_type not in DEMO_PROFILES:
            raise ValueError(fault_type)
        profile = DEMO_PROFILES[fault_type]
        branch = profile["branch"]
        with self.lock:
            self.active_faults[branch] = {
                "type": fault_type,
                "step": 0,
                "duration": 28,
                "profile": profile,
                "started_at": datetime.now().isoformat(timespec="seconds"),
            }
        return branch

    def inject(self, branch: str, fault_type: str) -> None:
        """Generic virtual injection; judging UI uses the validated profiles above."""
        if branch not in BRANCHES:
            raise KeyError(branch)
        if fault_type not in FAULT_TYPES:
            raise ValueError(fault_type)
        if fault_type in DEMO_PROFILES and DEMO_PROFILES[fault_type]["branch"] == branch:
            self.inject_profile(fault_type)
            return

        # Plausible fallback target generated from the branch's current baseline.
        base = self.base_readings[branch].copy()
        if fault_type == "overload":
            base["current"] += 16.0
            base["temperature"] += 17.0
        elif fault_type == "voltage_drop":
            base["voltage"] -= 31.0
        elif fault_type == "voltage_spike":
            base["voltage"] += 33.0
        elif fault_type == "overheat":
            base["temperature"] += 25.0
        with self.lock:
            self.active_faults[branch] = {
                "type": fault_type,
                "step": 0,
                "duration": 28,
                "profile": {"branch": branch, **base, "source": "generated fallback"},
                "started_at": datetime.now().isoformat(timespec="seconds"),
            }

    def _advance_base(self, branch: str) -> dict:
        cfg = BRANCHES[branch]
        tv, tc, tt = self._expected(branch)
        prev = self.base_readings[branch]
        # Gentle random walk around the branch's expected operating point.
        current = max(
            0.05,
            prev["current"] * 0.82 + tc * 0.18 + self.rng.gauss(0, cfg["current_std"] * 0.09),
        )
        temperature = prev["temperature"] * 0.88 + tt * 0.12 + self.rng.gauss(0, cfg["temp_std"] * 0.07)
        voltage = prev["voltage"] * 0.82 + tv * 0.18 + self.rng.gauss(0, 0.35)
        out = {"voltage": voltage, "current": current, "temperature": temperature}
        self.base_readings[branch] = out
        return out

    def _infer(self, branch: str, observed: dict, timestamp: str, event: Optional[dict]) -> dict:
        X = pd.DataFrame([[observed[k] for k in FEATURES]], columns=FEATURES)
        model = MODELS[branch]
        score = float(model.decision_function(X)[0])
        prediction = int(model.predict(X)[0])

        # Keep the exact thresholds from the supplied dashboard/model workflow.
        if score > 0.02:
            status = "normal"
        elif score > -0.04:
            status = "warning"
        else:
            status = "danger"

        if status != "normal":
            fault_type, z_scores = diagnose_values(
                observed["voltage"], observed["current"], observed["temperature"], BASELINES[branch]
            )
            fault = FAULT_TYPES[fault_type]
        else:
            fault_type = "none"
            z_scores = {"voltage": 0.0, "current": 0.0, "temperature": 0.0}
            fault = {"name_ar": "لا يوجد", "name_en": "None", "cause_ar": "", "fix_ar": ""}

        return {
            "timestamp": timestamp,
            "branch": branch,
            "branch_ar": BRANCHES[branch]["name_ar"],
            "branch_en": BRANCHES[branch]["name_en"],
            "voltage": round(observed["voltage"], 1),
            "current": round(observed["current"], 2),
            "temperature": round(observed["temperature"], 1),
            "status": status,
            "anomaly_score": round(score, 5),
            "model_prediction": "anomaly" if prediction == -1 else "normal",
            "fault_type": fault_type,
            "fault_ar": fault["name_ar"],
            "fault_en": fault["name_en"],
            "cause_ar": fault["cause_ar"],
            "fix_ar": fault["fix_ar"],
            "deviation_z": {k: round(float(v), 2) for k, v in z_scores.items()},
            "demo_fault_active": event["type"] if event else None,
            "demo_fault_strength": round(self._strength(event["step"], event["duration"]), 2) if event else 0.0,
        }

    def _update(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self.last_update < 0.75:
            return
        self.last_update = now
        self.sequence += 1
        timestamp = datetime.now().isoformat(timespec="seconds")

        for branch in BRANCHES:
            base = self._advance_base(branch)
            event = self.active_faults.get(branch)
            if event:
                strength = self._strength(event["step"], event["duration"])
                target = event["profile"]
                observed = {
                    "voltage": base["voltage"] * (1 - strength) + float(target["voltage"]) * strength,
                    "current": base["current"] * (1 - strength) + float(target["current"]) * strength,
                    "temperature": base["temperature"] * (1 - strength) + float(target["temperature"]) * strength,
                }
                # Infer before incrementing so strength reported matches the reading.
                reading = self._infer(branch, observed, timestamp, event)
                event["step"] += 1
                if event["step"] >= event["duration"]:
                    self.active_faults[branch] = None
            else:
                observed = base
                reading = self._infer(branch, observed, timestamp, None)

            self.latest[branch] = reading
            self.history[branch].append(reading)
            self._record_event(branch, reading)

    def _record_event(self, branch: str, reading: dict) -> None:
        """Store meaningful state transitions without flooding the event log."""
        previous = self.alert_state[branch]
        status = reading["status"]
        fault_type = reading.get("fault_type", "none")
        event_kind = None

        if status != "normal":
            if previous["status"] == "normal":
                event_kind = "detected"
            elif previous["status"] == "warning" and status == "danger":
                event_kind = "escalated"
            elif previous.get("fault_type") != fault_type:
                event_kind = "updated"
        elif previous["status"] != "normal":
            event_kind = "recovered"

        if event_kind:
            self.event_sequence += 1
            self.events.append({
                "id": self.event_sequence,
                "timestamp": reading["timestamp"],
                "branch": branch,
                "branch_ar": reading["branch_ar"],
                "branch_en": reading["branch_en"],
                "event_kind": event_kind,
                "status": status,
                "fault_type": fault_type,
                "fault_ar": reading.get("fault_ar", "لا يوجد"),
                "voltage": reading["voltage"],
                "current": reading["current"],
                "temperature": reading["temperature"],
                "anomaly_score": reading["anomaly_score"],
            })

        self.alert_state[branch] = {"status": status, "fault_type": fault_type}

    def snapshot(self) -> dict:
        with self.lock:
            self._update()
            latest = dict(self.latest)
            statuses = [r["status"] for r in latest.values()]
            return {
                "mode": "simulated",
                "sequence": self.sequence,
                "server_time": datetime.now().isoformat(timespec="seconds"),
                "summary": {
                    "normal": statuses.count("normal"),
                    "warning": statuses.count("warning"),
                    "danger": statuses.count("danger"),
                },
                "branches": latest,
                "events": list(self.events)[-12:][::-1],
            }

    def get_history(self, branch: str, limit: int = 60) -> list[dict]:
        if branch not in BRANCHES:
            raise KeyError(branch)
        with self.lock:
            self._update()
            return list(self.history[branch])[-max(1, min(int(limit), 120)):]


simulator = VirtualGrid()
app = FastAPI(title="HARIS Virtual Live API", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


@app.get("/api/version")
def version():
    return {"version": "1.3", "features": ["live-trends", "fault-log", "visual-alerts", "offline-ui"]}


@app.get("/api/health")
def health():
    return {"ok": True, "mode": "simulated", "models_loaded": list(MODELS), "demo_profiles": DEMO_PROFILES}


@app.get("/api/state")
def state():
    return simulator.snapshot()


@app.get("/api/history/{branch}")
def history(branch: str, limit: int = 60):
    try:
        return {"branch": branch, "readings": simulator.get_history(branch, limit)}
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown branch")


@app.post("/api/demo/{fault_type}")
def demo_fault(fault_type: str):
    try:
        branch = simulator.inject_profile(fault_type)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown demo fault type")
    return {"ok": True, "branch": branch, "fault_type": fault_type}


@app.post("/api/inject/{branch}/{fault_type}")
def inject_fault(branch: str, fault_type: str):
    try:
        simulator.inject(branch, fault_type)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown branch")
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown fault type")
    return {"ok": True, "branch": branch, "fault_type": fault_type}


@app.post("/api/reset")
def reset():
    simulator.reset()
    return {"ok": True}


@app.get("/api/events")
def events(limit: int = 20):
    with simulator.lock:
        n = max(1, min(int(limit), 80))
        return {"events": list(simulator.events)[-n:][::-1]}


@app.get("/api/validation-metrics")
def validation_metrics():
    return VALIDATION_METRICS
