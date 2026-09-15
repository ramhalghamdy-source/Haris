# HARIS — AI Electrical Panel Monitoring Prototype

**HARIS (حارس)** is an AI-enabled electrical panel monitoring prototype for four virtual electrical branches. It streams simulated voltage, current, and temperature readings, detects anomalous behavior, classifies each branch as **Normal / Warning / Danger**, and provides an interactive fault diagnosis with a probable cause and suggested action.

## Live Demo

**GitHub Pages:** https://ramhalghamdy-source.github.io/Haris/

The public demo runs entirely in the browser — **no Render server and no Python backend are required for the hosted site**. The browser generates virtual sensor readings, trains four lightweight Isolation Forest models, runs anomaly scoring, and updates the dashboard live.

> Prototype status: simulated sensor data + ML anomaly detection. This is a demonstrable MVP, not a production electrical-safety system.

## Monitored Branches

- HVAC & Cooling
- Lab Measurement Equipment
- Lighting
- General Sockets & Computers

## Live Demo Features

- Live virtual voltage, current, and temperature readings
- One client-side Isolation Forest per electrical branch
- Normal / Warning / Danger states
- Live anomaly scores and trend charts
- Interactive diagnosis panel
- Probable cause + suggested action
- Visual alert banner
- Fault/event history
- Demo fault injection for overload, voltage drop, voltage spike, and overheating
- Reset-to-normal control

## GitHub Pages Architecture

```text
Browser Virtual Sensors
        ↓
Isolation Forest × 4 (JavaScript)
        ↓
Anomaly score + status
        ↓
Fault diagnosis logic
        ↓
HARIS live dashboard
```

The site files are in `docs/` and are deployed automatically by `.github/workflows/pages.yml` whenever the GitHub Pages files change.

## Python Reference Implementation

The repository also keeps the original Python/FastAPI implementation and the scikit-learn models used during prototype development:

```text
app.py
haris_core.py
train_models.py
models/
static/
```

This version can still be run locally for model development, testing, and comparison with the browser demo.

### Local Python setup

```bash
python -m pip install -r requirements.txt
python run_haris.py
```

Then open:

```text
http://127.0.0.1:8000
```

## Important Notes

- The current data source is simulated, not a physical electrical sensor.
- The public GitHub Pages demo uses a browser-side Isolation Forest implementation trained on generated normal operating data.
- The original Python/scikit-learn implementation remains in the repository as the model-development reference.
- Human-readable fault diagnosis is inferred from the dominant sensor deviation after an anomaly is detected.
- Safety recommendations shown in the prototype are for demonstration and should not replace inspection by a qualified electrical professional.

## Arabic Documentation

See `README_AR.md` for Arabic project notes and local setup instructions.

---

**HARIS · Universities Challenge 2026 · Working Prototype**
