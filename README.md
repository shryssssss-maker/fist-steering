<div align="center">

# 🎮 Fist Steering Wheel Controller

**Control any driving game with your bare hands — no hardware, no phone, just a webcam.**

[![Python](https://img.shields.io/badge/Python-3.9%2B-blue?style=for-the-badge&logo=python)](https://python.org)
[![Windows](https://img.shields.io/badge/Windows-Only-0078D4?style=for-the-badge&logo=windows)](https://microsoft.com)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-1.0-orange?style=for-the-badge)](https://mediapipe.dev)
[![ViGEmBus](https://img.shields.io/badge/ViGEmBus-Virtual%20Xbox-green?style=for-the-badge)](https://github.com/nefarius/ViGEmBus)

> A single Python process that reads your webcam, tracks your hands and face in real-time using MediaPipe, and outputs a **virtual Xbox 360 controller** that any game can read — analog steering, a brake trigger, and a W-key toggle, all driven purely by gesture.

---

### 🚗 Try it immediately — no install needed

**Test game:** [Super Star Car on Poki](https://poki.com/en/g/super-star-car)  
Open the game, launch the script, tilt your fists — you're racing.

</div>

---

## ✨ What it does

| Gesture | What happens |
|---|---|
| 🤜🤛 Hold **both fists** up, tilt left/right | Analog left-stick X-axis — proportional steering |
| 🙍 **Raise eyebrows** | Left trigger fully pressed — brake |
| 🤚 Open **left palm** | Toggles `W` key held / released — gas in keyboard games |
| *(automatic)* | Right trigger at 40% — constant auto-throttle when not braking |

> **Why not keyboard?**  
> Keyboard keys are binary (down/up). A steering wheel needs a *continuous* value from −1.0 to +1.0. This project outputs a real virtual Xbox 360 controller axis — the same signal a physical thumbstick sends — so the game sees smooth, proportional turning at every angle.

---

## 🏗️ Architecture

```mermaid
flowchart TD
    CAM["Webcam via OpenCV"]
    FLIP["Horizontal Flip (mirror)"]
    MP_H["MediaPipe Hands (max 2)"]
    MP_F["MediaPipe FaceMesh (478 pts)"]
    STEER["Steering atan2 / 45deg"]
    SMOOTH["Smooth 0.20 prev + 0.80 raw"]
    DEAD["Deadzone below 0.05 zeroed"]
    BROW["Eyebrow (eye_y - brow_y) / face_h"]
    BRAKE["Brake delta > 0.18"]
    PALM["Left Palm 3+ fingers extended"]
    WTOG["Toggle W key (rising edge)"]
    OUT_S["Left Stick X axis"]
    OUT_B["Left Trigger 0 or 255"]
    OUT_T["Right Trigger 40%"]
    OUT_W["pynput W press/release"]
    GPAD["Virtual Xbox 360 vgamepad"]
    HUD["OpenCV live HUD overlay"]

    CAM --> FLIP
    FLIP --> MP_H
    FLIP --> MP_F
    FLIP --> HUD
    MP_H --> STEER
    STEER --> SMOOTH
    SMOOTH --> DEAD
    DEAD --> OUT_S
    MP_H --> PALM
    PALM --> WTOG
    WTOG --> OUT_W
    MP_F --> BROW
    BROW --> BRAKE
    BRAKE --> OUT_B
    BRAKE -->|not braking| OUT_T
    OUT_S --> GPAD
    OUT_B --> GPAD
    OUT_T --> GPAD
```

---

## 🧠 How each gesture is computed

### Steering — wrist angle → analog axis

```mermaid
sequenceDiagram
    participant Cam as Webcam
    participant MP as MediaPipe Hands
    participant Math as Steering Math
    participant GP as Virtual Gamepad

    Cam->>MP: RGB frame
    MP-->>Math: left wrist x,y and right wrist x,y
    Note over Math: dx = right.x - left.x
    Note over Math: dy = right.y - left.y
    Note over Math: angle = degrees(atan2(dy, dx))
    Note over Math: steering = clamp(angle / 45, -1, 1)
    Note over Math: smooth = 0.20 x prev + 0.80 x steering
    Note over Math: if abs(smooth) < 0.05 then zero
    Math-->>GP: left_joystick(x = int16(smooth))
```

**When fewer than 2 hands are visible**, `smooth_steer *= 0.85` each frame — steering decays to zero rather than freezing at the last value.

---

### Brake — eyebrow raise → left trigger

```mermaid
sequenceDiagram
    participant FM as FaceMesh 478 landmarks
    participant Calc as Ratio Calc
    participant Cal as Calibration Baseline
    participant GP as Virtual Gamepad

    FM-->>Calc: lm[105] lm[334] eyebrow tops
    FM-->>Calc: lm[159] lm[386] upper eyelids
    FM-->>Calc: lm[10] forehead and lm[152] chin
    Note over Calc: brow_y = avg(left_brow, right_brow)
    Note over Calc: eye_y  = avg(left_eye,  right_eye)
    Note over Calc: face_h = abs(chin_y - forehead_y)
    Note over Calc: ratio  = (eye_y - brow_y) / face_h
    Cal-->>Calc: baseline = mean of 3s neutral samples
    Note over Calc: delta = ratio - baseline
    Note over Calc: if delta > 0.18 then brake ON
    Calc-->>GP: left_trigger(255) or left_trigger(0)
```

---

### W-key toggle — left open palm

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Fist : startup
    Fist --> Palm : open left palm
    Palm --> Fist : open left palm again

    state Fist {
        note right of Fist: Left fist closed, W released
    }
    state Palm {
        note right of Palm: Left palm open, W held
    }
```

**Side detection:** After `cv2.flip(frame, 1)` (mirror mode), `wrist_x < 0.5` reliably identifies the user's physical left hand regardless of which hand MediaPipe labels it.

---

## 🗂️ Controller output map

```mermaid
flowchart LR
    G1[Both fists tilted] --> O1[Left Stick X]
    G2[Raise eyebrows] --> O2[Left Trigger]
    G3[Left palm open toggle] --> O3[pynput W key]
    G4[Auto no brake] --> O4[Right Trigger 40%]
```

---

## ⚙️ Tunable constants

All constants live at the **very top of `fist_steering.py`** — edit once, nowhere else.

| Constant | Default | What it controls |
|---|---|---|
| `MAX_TILT_DEG` | `45.0` | Tilt angle (°) for full ±1.0 steering lock |
| `SMOOTHING` | `0.20` | Exponential smoothing weight — 0 = raw, 1 = frozen |
| `DEADZONE` | `0.05` | Noise floor — values below this are zeroed and rescaled |
| `EYEBROW_RAISE_THRESHOLD` | `0.18` | Eyebrow-delta fraction above baseline that triggers brake |
| `CALIBRATION_SECONDS` | `3` | Hold-neutral countdown duration at startup |
| `AUTO_THROTTLE_ENABLED` | `True` | Toggle constant right-trigger throttle on/off |
| `AUTO_THROTTLE_VALUE` | `0.40` | Right-trigger strength when auto-throttle is active |
| `LOST_HAND_DECAY` | `0.85` | Per-frame steering decay multiplier when hands leave frame |
| `PALM_KEYS_ENABLED` | `True` | Toggle the left-palm → W feature on/off |
| `PALM_OPEN_FINGERS` | `3` | Minimum extended fingers to count as "open palm" (1–4) |
| `CAMERA_INDEX` | `0` | Webcam index — change if you have multiple cameras |

---

## 🚀 Setup — Windows (from GitHub)

### Prerequisites

- **Windows 10 or 11** (64-bit)
- **Python 3.9 – 3.11** — [download here](https://www.python.org/downloads/)  
  ✅ Check **"Add Python to PATH"** during install
- A **webcam** (built-in or USB)

---

### Step 1 — Clone the repo

```powershell
git clone https://github.com/YOUR_USERNAME/gamecv.git
cd gamecv
```

---

### Step 2 — Install Python dependencies

```powershell
pip install opencv-python "mediapipe==0.10.21" vgamepad pynput
```

> **`mediapipe==0.10.21`** is pinned because version 1.x removed the `mp.solutions` API that this project uses.

---

### Step 3 — Install the ViGEmBus driver (one-time)

`vgamepad` wraps the **ViGEmBus** kernel driver to create virtual Xbox controllers. It will attempt to auto-install on first run.

**If the auto-install fails** (common on UAC-hardened systems):

1. Right-click your terminal shortcut → **Run as Administrator**
2. `python fist_steering.py`
3. Accept the **Nefarius Virtual Gamepad Emulation Bus Driver** license dialog that appears
4. After install completes, you never need admin again

---

### Step 4 — Run

```powershell
python fist_steering.py
```

**What happens:**

```mermaid
sequenceDiagram
    participant Script
    participant Window as Camera Window
    participant Game

    Script->>Window: Open Fist Steering Calibration
    Note over Window: 3 second countdown hold neutral expression
    Window-->>Script: Eyebrow baseline saved
    Script->>Window: Open Fist Steering Wheel Controller
    Note over Window: Live hand and face tracking active
    Script->>Game: Virtual Xbox 360 controller appears
    Note over Game: Go to Settings Controls and select Xbox 360 Controller
    loop Every frame
        Script->>Game: left_joystick steering value
        Script->>Game: left_trigger brake
        Script->>Game: right_trigger throttle 40%
    end
```

---

### Step 5 — Play!

Open [Super Star Car](https://poki.com/en/g/super-star-car) (or any driving game), go to its **Controls / Input settings**, and select the **Xbox 360 Controller** that has appeared.

Then:

| Do this | Game input |
|---|---|
| ✊✊ Hold both fists up, level | Car goes straight |
| ↙️ Tilt left (right wrist higher) | Steer left — continuously proportional |
| ↘️ Tilt right (right wrist lower) | Steer right — continuously proportional |
| 😲 Raise eyebrows | Brake |
| 🖐 Open left palm | W key held (gas in keyboard-mode games) |
| 🖐 Open left palm again | W key released |
| `Q` in camera window | Clean quit — all inputs reset to neutral |

---

## 📦 Package as a standalone `.exe`

No Python required on the target machine:

```powershell
pip install pyinstaller
pyinstaller --onefile --noconsole --name FistSteering fist_steering.py
```

Output: `dist\FistSteering.exe`

> ⚠️ The end user still needs **ViGEmBus** installed. The first run of the `.exe` will attempt to auto-install it — run as Administrator once to allow that.

---

## 🔧 Troubleshooting

| Symptom | Fix |
|---|---|
| `AttributeError: module 'mediapipe' has no attribute 'solutions'` | `pip install "mediapipe==0.10.21"` |
| `Could not create virtual gamepad` | Run as Administrator once to install ViGEmBus |
| Steering jitters / drifts | Increase `SMOOTHING` or `DEADZONE` |
| Brake fires too easily | Increase `EYEBROW_RAISE_THRESHOLD` |
| W toggles by itself | Increase `PALM_OPEN_FINGERS` to 4 |
| Wrong camera opens | Change `CAMERA_INDEX` to 1, 2, etc. |
| Steering reversed | Physically hold fists the other way, or negate the atan2 result |

---

## 🏛️ Tech stack

| Layer | Library | Purpose |
|---|---|---|
| Computer vision | `opencv-python 5.x` | Webcam capture, frame flip, HUD drawing |
| Hand tracking | `mediapipe 0.10.21` — `mp.solutions.hands` | 21 landmarks per hand, up to 2 hands |
| Face tracking | `mediapipe 0.10.21` — `mp.solutions.face_mesh` | 478 landmarks, `refine_landmarks=True` |
| Virtual controller | `vgamepad 0.1.0` + ViGEmBus | Virtual Xbox 360 `VX360Gamepad` |
| Keyboard injection | `pynput 1.8.x` | W key press/release for the palm toggle |
| Packaging | `pyinstaller` | Single-file `.exe` with `--onefile --noconsole` |

---

## 📄 License

MIT — do whatever you want with it.

---

<div align="center">
Made with ☕ and a webcam
</div>
