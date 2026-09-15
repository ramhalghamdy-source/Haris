"""Core configuration and diagnosis logic for HARIS."""
from __future__ import annotations

from typing import Dict

BRANCHES: Dict[str, dict] = {
    "hvac": {
        "name_ar": "التكييف والتبريد",
        "name_en": "HVAC & Cooling",
        "current_day": 9.0,
        "current_night": 6.0,
        "current_std": 1.0,
        "temp_day": 34.0,
        "temp_night": 27.0,
        "temp_std": 2.0,
    },
    "lab_equipment": {
        "name_ar": "أجهزة القياس الحساسة",
        "name_en": "Lab Measurement Equipment",
        "current_day": 4.0,
        "current_night": 0.5,
        "current_std": 0.6,
        "temp_day": 29.0,
        "temp_night": 24.0,
        "temp_std": 1.2,
    },
    "lighting": {
        "name_ar": "الإضاءة",
        "name_en": "Lighting",
        "current_day": 3.0,
        "current_night": 0.3,
        "current_std": 0.4,
        "temp_day": 27.0,
        "temp_night": 23.0,
        "temp_std": 1.0,
    },
    "sockets": {
        "name_ar": "المقابس العامة وأجهزة الكمبيوتر",
        "name_en": "General Sockets & Computers",
        "current_day": 7.0,
        "current_night": 1.0,
        "current_std": 1.8,
        "temp_day": 31.0,
        "temp_night": 25.0,
        "temp_std": 1.8,
    },
}

VOLTAGE_MEAN = 220.0
VOLTAGE_STD = 3.0

FAULT_TYPES: Dict[str, dict] = {
    "overload": {
        "name_ar": "حمل زائد",
        "name_en": "Overload",
        "cause_ar": "عدد الأجهزة الموصولة على هذا الخط أكبر من طاقته التشغيلية المتوقعة.",
        "fix_ar": "خفّضي الحمل ووزّعي الأجهزة على خط آخر، ثم اطلبي من فني مختص التأكد من ملاءمة القاطع وسعة الخط.",
    },
    "voltage_drop": {
        "name_ar": "هبوط جهد مفاجئ",
        "name_en": "Voltage Drop",
        "cause_ar": "قد يشير إلى اتصال ضعيف أو طرف كهربائي مرتخٍ أو هبوط في مصدر التغذية.",
        "fix_ar": "افصلي الأحمال الحساسة واطلبي من فني مختص فحص التوصيلات والأطراف ومصدر التغذية.",
    },
    "voltage_spike": {
        "name_ar": "ارتفاع جهد مفاجئ",
        "name_en": "Voltage Spike",
        "cause_ar": "قد ينتج عن عدم استقرار مصدر التغذية أو مشكلة في الحماية أو التأريض.",
        "fix_ar": "اعزلي الأجهزة الحساسة واطلبي فحص التأريض والحماية من زيادة الجهد بواسطة فني مؤهل.",
    },
    "overheat": {
        "name_ar": "ارتفاع حرارة غير مبرر",
        "name_en": "Unexpected Overheating",
        "cause_ar": "قد يدل على تحميل زائد، مقاومة مرتفعة في نقطة توصيل، أو تدهور في العزل أو القاطع.",
        "fix_ar": "أوقفي الخط إذا كان ذلك آمنًا واطلبي فحصه من فني كهربائي مؤهل قبل إعادة التشغيل.",
    },
}

BRANCH_FAULT_WEIGHTS = {
    "hvac": {"overload": 0.50, "overheat": 0.35, "voltage_drop": 0.10, "voltage_spike": 0.05},
    "lab_equipment": {"voltage_spike": 0.50, "voltage_drop": 0.30, "overheat": 0.10, "overload": 0.10},
    "lighting": {"voltage_drop": 0.40, "voltage_spike": 0.30, "overload": 0.15, "overheat": 0.15},
    "sockets": {"overload": 0.55, "overheat": 0.25, "voltage_drop": 0.10, "voltage_spike": 0.10},
}


def diagnose_values(voltage: float, current: float, temperature: float, baseline: dict) -> tuple[str, dict]:
    """Rule-based fault *type* diagnosis after Isolation Forest flags deviation.

    Isolation Forest decides whether the multivariate reading is unusual. This
    function explains the dominant deviation in terms meaningful to the UI.
    """
    v_std = max(float(baseline["voltage_std"]), 1e-6)
    c_std = max(float(baseline["current_std"]), 1e-6)
    t_std = max(float(baseline["temp_std"]), 1e-6)

    v_dev = voltage - float(baseline["voltage_mean"])
    c_dev = current - float(baseline["current_mean"])
    t_dev = temperature - float(baseline["temp_mean"])

    scores = {
        "voltage": abs(v_dev) / v_std,
        "current": abs(c_dev) / c_std,
        "temperature": abs(t_dev) / t_std,
    }
    dominant = max(scores, key=scores.get)

    if dominant == "voltage":
        fault = "voltage_spike" if v_dev > 0 else "voltage_drop"
    elif dominant == "current" and scores["temperature"] > 2.0:
        fault = "overload"
    elif dominant == "temperature":
        fault = "overheat"
    else:
        fault = "overload"

    return fault, scores
