"""Train the four HARIS Isolation Forest models on the project's virtual data.

The data generation and model settings intentionally mirror the supplied HARIS
scripts so the validation figures remain reproducible. The only additions are:
model persistence, baseline persistence, metrics.json, and four pre-validated
fault profiles used by the judging demo.
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import accuracy_score, precision_score, recall_score

from haris_core import BRANCHES, BRANCH_FAULT_WEIGHTS, VOLTAGE_MEAN, VOLTAGE_STD, diagnose_values

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models"
DATA_DIR = ROOT / "data"
MODEL_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)
FEATURES = ["voltage", "current", "temperature"]


def generate_dataset(seed: int = 42, n_days: int = 14) -> pd.DataFrame:
    # Use the legacy NumPy RNG on purpose: this reproduces the supplied script.
    np.random.seed(seed)
    timestamps = pd.date_range("2026-08-01", periods=n_days * 24 * 60, freq="1min")
    all_rows = []

    for branch_id, b in BRANCHES.items():
        for ts in timestamps:
            is_day = 8 <= ts.hour < 20
            voltage = np.random.normal(VOLTAGE_MEAN, VOLTAGE_STD)
            current = np.random.normal(
                b["current_day"] if is_day else b["current_night"], b["current_std"]
            )
            temperature = np.random.normal(
                b["temp_day"] if is_day else b["temp_night"], b["temp_std"]
            )
            all_rows.append([
                ts, branch_id, voltage, max(current, 0.05), temperature, 0, "none"
            ])

    df = pd.DataFrame(all_rows, columns=[
        "timestamp", "branch", "voltage", "current", "temperature", "is_anomaly", "fault_type"
    ])

    def inject_fault(idx_range, kind):
        for i in idx_range:
            if kind == "overload":
                df.loc[i, "current"] += np.random.uniform(10, 20)
                df.loc[i, "temperature"] += np.random.uniform(10, 22)
            elif kind == "voltage_drop":
                df.loc[i, "voltage"] -= np.random.uniform(18, 38)
            elif kind == "voltage_spike":
                df.loc[i, "voltage"] += np.random.uniform(22, 42)
            elif kind == "overheat":
                df.loc[i, "temperature"] += np.random.uniform(18, 30)
            df.loc[i, "is_anomaly"] = 1
            df.loc[i, "fault_type"] = kind

    for branch_id in BRANCHES:
        branch_rows = df[df["branch"] == branch_id].index.to_numpy()
        weights = BRANCH_FAULT_WEIGHTS[branch_id]
        kinds = list(weights.keys())
        probs = list(weights.values())
        for _ in range(10):
            start_pos = np.random.randint(0, len(branch_rows) - 60)
            duration = np.random.randint(5, 40)
            kind = np.random.choice(kinds, p=probs)
            inject_fault(branch_rows[start_pos:start_pos + duration], kind)

    return df


def train_all(save_csv: bool = False) -> dict:
    df = generate_dataset()
    results = []
    branch_metrics = []
    baselines = {}
    models = {}

    for branch_id in BRANCHES:
        sub = df[df["branch"] == branch_id].reset_index(drop=True).copy()
        X = sub[FEATURES]

        model = IsolationForest(n_estimators=200, contamination=0.012, random_state=42)
        model.fit(X)
        models[branch_id] = model

        sub["prediction_raw"] = model.predict(X)
        sub["predicted_anomaly"] = (sub["prediction_raw"] == -1).astype(int)
        sub["anomaly_score"] = model.decision_function(X)

        normal = sub[sub["is_anomaly"] == 0]
        baseline = {
            "voltage_mean": float(normal["voltage"].mean()),
            "voltage_std": float(normal["voltage"].std()),
            "current_mean": float(normal["current"].mean()),
            "current_std": float(normal["current"].std()),
            "temp_mean": float(normal["temperature"].mean()),
            "temp_std": float(normal["temperature"].std()),
        }
        baselines[branch_id] = baseline

        diagnosed = []
        for row in sub.itertuples(index=False):
            if row.predicted_anomaly == 1:
                fault, _ = diagnose_values(row.voltage, row.current, row.temperature, baseline)
                diagnosed.append(fault)
            else:
                diagnosed.append("none")
        sub["diagnosed_fault"] = diagnosed

        detected = sub[(sub["predicted_anomaly"] == 1) & (sub["is_anomaly"] == 1)]
        branch_metrics.append({
            "branch": branch_id,
            "overall_accuracy": float(accuracy_score(sub["is_anomaly"], sub["predicted_anomaly"])),
            "anomaly_recall": float(recall_score(sub["is_anomaly"], sub["predicted_anomaly"], zero_division=0)),
            "anomaly_precision": float(precision_score(sub["is_anomaly"], sub["predicted_anomaly"], zero_division=0)),
            "diagnosis_accuracy_detected": float((detected["diagnosed_fault"] == detected["fault_type"]).mean()) if len(detected) else 0.0,
            "real_anomaly_points": int(sub["is_anomaly"].sum()),
            "detected_real_anomaly_points": int(len(detected)),
        })

        joblib.dump(model, MODEL_DIR / f"{branch_id}_isolation_forest.joblib")
        with open(MODEL_DIR / f"{branch_id}_baseline.json", "w", encoding="utf-8") as f:
            json.dump(baseline, f, ensure_ascii=False, indent=2)
        results.append(sub)

    full = pd.concat(results, ignore_index=True)
    detected = full[(full["predicted_anomaly"] == 1) & (full["is_anomaly"] == 1)]
    overall = {
        "overall_accuracy": float(accuracy_score(full["is_anomaly"], full["predicted_anomaly"])),
        "anomaly_recall": float(recall_score(full["is_anomaly"], full["predicted_anomaly"], zero_division=0)),
        "anomaly_precision": float(precision_score(full["is_anomaly"], full["predicted_anomaly"], zero_division=0)),
        "diagnosis_accuracy_detected": float((detected["diagnosed_fault"] == detected["fault_type"]).mean()) if len(detected) else 0.0,
        "total_rows": int(len(full)),
        "real_anomaly_points": int(full["is_anomaly"].sum()),
        "detected_real_anomaly_points": int(len(detected)),
    }
    metrics = {
        "note_ar": "المقاييس تخص بيانات محاكاة وليست تحققًا ميدانيًا من حساسات كهربائية حقيقية.",
        "overall": overall,
        "branches": branch_metrics,
    }
    with open(MODEL_DIR / "metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)

    # Four judging scenarios are deliberately mapped to the branch where that
    # fault is most plausible in the project's fault-weight assumptions.
    scenario_map = {
        "overload": "sockets",
        "voltage_drop": "lighting",
        "voltage_spike": "lab_equipment",
        "overheat": "hvac",
    }
    profiles = {}
    for fault_type, branch_id in scenario_map.items():
        candidates = full[
            (full["branch"] == branch_id)
            & (full["fault_type"] == fault_type)
            & (full["predicted_anomaly"] == 1)
            & (full["diagnosed_fault"] == fault_type)
            & (full["anomaly_score"] <= -0.04)
        ].copy()
        if candidates.empty:
            raise RuntimeError(f"No reliable demo profile for {branch_id}/{fault_type}")
        # Pick a moderate danger example, not the most extreme one.
        candidates["distance_to_target"] = (candidates["anomaly_score"] + 0.06).abs()
        row = candidates.sort_values("distance_to_target").iloc[0]
        profiles[fault_type] = {
            "branch": branch_id,
            "voltage": round(float(row["voltage"]), 3),
            "current": round(float(row["current"]), 3),
            "temperature": round(float(row["temperature"]), 3),
            "expected_score": round(float(row["anomaly_score"]), 6),
            "source": "validated synthetic row",
        }

    with open(MODEL_DIR / "demo_fault_profiles.json", "w", encoding="utf-8") as f:
        json.dump(profiles, f, ensure_ascii=False, indent=2)

    if save_csv:
        df.to_csv(DATA_DIR / "haris_virtual_training_data.csv", index=False)
        full.to_csv(DATA_DIR / "haris_virtual_validation_results.csv", index=False)

    return metrics


if __name__ == "__main__":
    print(json.dumps(train_all(save_csv=False), ensure_ascii=False, indent=2))
