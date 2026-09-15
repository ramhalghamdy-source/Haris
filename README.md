# HARIS — AI Electrical Panel Monitoring Prototype

**HARIS (حارس)** is a working prototype for monitoring four virtual electrical branches using live simulated sensor readings and branch-specific **Isolation Forest** anomaly-detection models.

The dashboard streams voltage, current, and temperature readings, classifies the branch state as **Normal / Warning / Danger**, and provides an interactive fault diagnosis with a probable cause and suggested action.

> Prototype status: simulated sensor data + trained ML models. It is designed as a demonstrable MVP, not as a production electrical-safety system.

## Features

- Four monitored branches:
  - HVAC & Cooling
  - Lab Measurement Equipment
  - Lighting
  - General Sockets & Computers
- Live virtual sensor stream for voltage, current, and temperature
- One Isolation Forest model per branch
- Normal / Warning / Danger status
- Interactive fault diagnosis
- Probable cause + suggested action
- Live anomaly-score mini charts
- Detailed live trend view for the selected branch
- Visual alert banner
- Fault/event history
- Demo fault injection for:
  - Overload
  - Voltage drop
  - Voltage spike
  - Unexpected overheating
- Reset-to-normal demo control
- Local FastAPI backend + browser dashboard

## Architecture

```text
Virtual Sensors
      ↓
Python simulation engine
      ↓
Isolation Forest × 4
      ↓
Anomaly score + status
      ↓
Fault diagnosis logic
      ↓
FastAPI API
      ↓
HARIS dashboard
```

## Repository Structure

```text
HARIS/
├── app.py                 # FastAPI application + live simulation state
├── haris_core.py          # Branch configuration and diagnosis logic
├── train_models.py        # Rebuilds the Isolation Forest models
├── run_haris.py           # Local launcher
├── smoke_test.py          # Basic functional test
├── requirements.txt
├── start_haris.bat        # Windows launcher
├── start_haris.sh         # macOS/Linux launcher
├── setup_windows.bat
├── setup_mac_linux.sh
├── static/
│   └── index.html         # Dashboard UI
├── models/
│   ├── *_isolation_forest.joblib
│   ├── *_baseline.json
│   ├── demo_fault_profiles.json
│   └── metrics.json
├── data/
├── README_AR.md
└── OFFLINE_DEMO_CHECKLIST.txt
```

## Quick Start — Windows

### 1. Clone the repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd HARIS
```

Or download the repository as a ZIP from GitHub and extract it.

### 2. Install requirements

Double-click:

```text
setup_windows.bat
```

Or run manually:

```bash
python -m pip install -r requirements.txt
```

### 3. Start HARIS

Double-click:

```text
start_haris.bat
```

The dashboard should open automatically. If it does not, open:

```text
http://127.0.0.1:8000
```

## macOS / Linux

```bash
chmod +x setup_mac_linux.sh start_haris.sh
./setup_mac_linux.sh
./start_haris.sh
```

Then open `http://127.0.0.1:8000`.

## Rebuild the ML Models

The pre-trained model files are included in `models/` so the demo can run immediately.

To regenerate them:

```bash
python train_models.py
```

The project intentionally pins `scikit-learn==1.8.0` because the included `.joblib` model files were serialized with that version.

## Demo Flow

1. Start HARIS and confirm the reading counter increases.
2. Select any branch to inspect its live trends.
3. Trigger one of the demo faults.
4. Watch the sensor values move away from baseline.
5. Observe the model change the branch from Normal to Warning/Danger.
6. Open the diagnosis panel to see the detected fault type, probable cause, and suggested action.
7. Review the event log.
8. Press **Reset to normal** to clear the demo scenario.

## API Endpoints

- `GET /api/health` — server health
- `GET /api/state` — latest state for all four branches
- `GET /api/history/{branch}` — recent readings for one branch
- `GET /api/events` — recent fault events
- `GET /api/validation-metrics` — stored model metrics
- `POST /api/demo/{fault_type}` — run a predefined demo fault
- `POST /api/inject/{branch}/{fault_type}` — inject a selected fault
- `POST /api/reset` — reset the live demo

## Important Notes

- The current data source is **simulated**, not a physical electrical sensor.
- Isolation Forest performs anomaly detection; the human-readable fault type is inferred from the dominant deviation after an anomaly is detected.
- The safety recommendations shown in the prototype are for demonstration and should not replace inspection by a qualified electrical professional.
- GitHub can host the **source repository**, but this Python/FastAPI project cannot run directly on GitHub Pages. A hosted public version would need a Python-capable deployment service.

## Arabic Documentation

See [README_AR.md](README_AR.md) for the Arabic quick-start and demo instructions.

---

**HARIS · Universities Challenge 2026 · Working Prototype**
