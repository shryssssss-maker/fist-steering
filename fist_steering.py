"""
╔══════════════════════════════════════════════════════════════════════════════╗
║         FIST STEERING WHEEL CONTROLLER  —  Windows Virtual Gamepad          ║
║                                                                              ║
║  Hold both fists up like gripping a steering wheel.                         ║
║  • Tilt the "wheel" left/right  →  Left Analog Stick X (analog steering)   ║
║  • Raise eyebrows               →  Brake (Left Trigger)                     ║
║  • Auto-throttle when no brake  →  Right Trigger at constant value          ║
║                                                                              ║
║  REQUIRES (install once):                                                   ║
║    pip install opencv-python mediapipe vgamepad                             ║
║    ViGEmBus driver — vgamepad auto-installs it on first run (run as Admin) ║
║                                                                              ║
║  WINDOWS ONLY — vgamepad wraps ViGEmBus, a Windows-only kernel driver.     ║
║                                                                              ║
║  PACKAGING as single .exe:                                                  ║
║    pyinstaller --onefile --noconsole --name FistSteering fist_steering.py  ║
║    (add --icon=your_icon.ico to embed a custom icon)                        ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

# ─────────────────────────────────────────────────────────────────────────────
#  ARGPARSE & CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────
import argparse
import json

parser = argparse.ArgumentParser(description="Fist Steering Wheel Controller")
parser.add_argument("--camera", type=int, default=0)
parser.add_argument("--smooth", type=float, default=0.20)
parser.add_argument("--deadzone", type=float, default=0.05)
parser.add_argument("--tilt", type=float, default=45.0)
parser.add_argument("--disable-brake", action="store_true")
parser.add_argument("--eyebrow-threshold", type=float, default=0.18)
parser.add_argument("--disable-throttle", action="store_true")
parser.add_argument("--throttle-value", type=float, default=0.40)
parser.add_argument("--disable-palm", action="store_true")
parser.add_argument("--palm-fingers", type=int, default=3)
parser.add_argument("--probe-cameras", action="store_true")
parser.add_argument("--benchmark", action="store_true")
parser.add_argument("--benchmark-time", type=float, default=0.0)
parser.add_argument("--verbose", action="store_true")
parser.add_argument("--quiet", action="store_true")

args, _ = parser.parse_known_args()

MAX_TILT_DEG: float = args.tilt
SMOOTHING: float = args.smooth
DEADZONE: float = args.deadzone
EYEBROW_RAISE_THRESHOLD: float = args.eyebrow_threshold
CALIBRATION_SECONDS: int = 3
AUTO_THROTTLE_ENABLED: bool = not args.disable_throttle
AUTO_THROTTLE_VALUE: float = args.throttle_value
LOST_HAND_DECAY: float = 0.85
PALM_KEYS_ENABLED: bool = not args.disable_palm
PALM_OPEN_FINGERS: int = args.palm_fingers
CAMERA_INDEX: int = args.camera
DISABLE_BRAKE: bool = args.disable_brake
BENCHMARK_MODE: bool = args.benchmark
BENCHMARK_TIME: float = args.benchmark_time
VERBOSE: bool = args.verbose
QUIET: bool = args.quiet

def log(msg, verbose_only=False):
    if QUIET: return
    if verbose_only and not VERBOSE: return
    print(msg)

# ─────────────────────────────────────────────────────────────────────────────
#  IMPORTS
# ─────────────────────────────────────────────────────────────────────────────

import sys
import math
import time
import atexit
import signal
import traceback
from typing import Optional, Tuple

import cv2
import mediapipe as mp
from pynput.keyboard import Controller as KbController
import numpy as np

try:
    import vgamepad as vg
except ImportError:
    log(
        "\n[ERROR] vgamepad is not installed.\n"
        "Run:  pip install vgamepad\n"
        "ViGEmBus driver will be auto-installed on first run (requires admin).\n"
    )
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────────────────
#  MEDIAPIPE SETUP
# ─────────────────────────────────────────────────────────────────────────────

mp_hands = mp.solutions.hands
mp_face_mesh = mp.solutions.face_mesh
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles

# FaceMesh landmark indices for eyebrow detection
EYEBROW_L_IDX: int = 105   # left eyebrow top
EYEBROW_R_IDX: int = 334   # right eyebrow top
EYE_L_IDX: int = 159        # left upper eyelid
EYE_R_IDX: int = 386        # right upper eyelid
FOREHEAD_IDX: int = 10      # forehead center (for face-height normalisation)
CHIN_IDX: int = 152         # chin center

# Hand landmark indices used for open-palm detection
# Fingertip indices:  thumb=4, index=8, middle=12, ring=16, pinky=20
# Proximal knuckle (MCP) indices: index=5, middle=9, ring=13, pinky=17
FINGER_TIPS: tuple = (8, 12, 16, 20)   # index, middle, ring, pinky tips
FINGER_MCPS: tuple = (5,  9, 13, 17)   # their corresponding MCP knuckles

# ─────────────────────────────────────────────────────────────────────────────
#  VIRTUAL GAMEPAD
# ─────────────────────────────────────────────────────────────────────────────

# Gamepad initialized in main()
gamepad = None


# Keyboard controller for the palm→key toggles
_kb = KbController()
_w_held: bool = False   # True while W is being held


def _release_keys_if_held() -> None:
    """Release W if currently held — called on cleanup."""
    global _w_held
    if _w_held:
        try:
            _kb.release('w')
        except Exception:
            pass
        _w_held = False
        log("[EXIT] W key released.")


def reset_gamepad() -> None:
    """Reset all gamepad inputs to neutral — always called on exit."""
    _release_keys_if_held()
    try:
        if gamepad:
            gamepad.left_joystick(x_value=0, y_value=0)
            gamepad.right_joystick(x_value=0, y_value=0)
            gamepad.left_trigger(value=0)
            gamepad.right_trigger(value=0)
            gamepad.update()
            log("[EXIT] Gamepad reset to neutral.", verbose_only=True)
    except Exception:
        pass  # already gone — ignore


atexit.register(reset_gamepad)
signal.signal(signal.SIGINT, lambda *_: (reset_gamepad(), sys.exit(0)))
signal.signal(signal.SIGTERM, lambda *_: (reset_gamepad(), sys.exit(0)))

# ─────────────────────────────────────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def float_to_joystick(value: float) -> int:
    """Map [-1.0, 1.0] → int16 range [-32768, 32767] for vgamepad."""
    clamped = max(-1.0, min(1.0, value))
    return int(clamped * 32767) if clamped >= 0 else int(clamped * 32768)


def float_to_trigger(value: float) -> int:
    """Map [0.0, 1.0] → byte range [0, 255] for vgamepad trigger."""
    return int(max(0.0, min(1.0, value)) * 255)


# ─────────────────────────────────────────────────────────────────────────────
#  CALIBRATION
# ─────────────────────────────────────────────────────────────────────────────

def run_calibration(
    cap: cv2.VideoCapture,
    face_mesh,
) -> Optional[float]:
    """
    Show a countdown and sample the eyebrow-raise ratio as the neutral baseline.
    Returns the baseline float, or None if aborted / no face detected.
    """
    start_time = time.time()
    samples = []
    window_name = "Fist Steering — Calibration"

    log(
        f"\n[CALIBRATION] Hold a NEUTRAL expression for {CALIBRATION_SECONDS} seconds…"
    )

    while True:
        elapsed = time.time() - start_time
        remaining = max(0.0, CALIBRATION_SECONDS - elapsed)

        ret, frame = cap.read()
        if not ret:
            continue

        frame = cv2.flip(frame, 1)
        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = face_mesh.process(rgb)

        if results.multi_face_landmarks:
            lm = results.multi_face_landmarks[0].landmark
            ratio = _eyebrow_raise_ratio(lm)
            if ratio is not None:
                samples.append(ratio)

        # Dim the frame for readability
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (w, h), (20, 20, 20), -1)
        frame = cv2.addWeighted(overlay, 0.55, frame, 0.45, 0)

        lines = [
            ("CALIBRATION", 1.2, (80, 200, 255)),
            ("Hold a NEUTRAL expression", 0.7, (220, 220, 220)),
            (f"Starting in  {remaining:.1f}s", 0.9, (100, 255, 100)),
        ]
        for i, (text, scale, color) in enumerate(lines):
            tw, _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, scale, 2)[0]
            tx = (w - tw) // 2
            ty = h // 2 - 60 + i * 55
            cv2.putText(frame, text, (tx, ty), cv2.FONT_HERSHEY_DUPLEX, scale, color, 2, cv2.LINE_AA)

        cv2.imshow(window_name, frame)

        if elapsed >= CALIBRATION_SECONDS:
            break

        if (cv2.waitKey(1) & 0xFF) == ord('q'):
            return None

    if not samples:
        log("[CALIBRATION] No face detected — using default baseline 0.30")
        return 0.30

    baseline = float(np.mean(samples))
    log(f"[CALIBRATION] Done. Eyebrow baseline = {baseline:.4f}")
    return baseline


# ─────────────────────────────────────────────────────────────────────────────
#  EYEBROW-RAISE METRIC
# ─────────────────────────────────────────────────────────────────────────────

def _eyebrow_raise_ratio(landmarks) -> Optional[float]:
    """
    Normalised eyebrow-to-eye vertical gap.
    Raises when eyebrows move up (y decreases), so ratio increases.
    Returns None on bad data.
    """
    try:
        eb_y = (landmarks[EYEBROW_L_IDX].y + landmarks[EYEBROW_R_IDX].y) / 2.0
        eye_y = (landmarks[EYE_L_IDX].y + landmarks[EYE_R_IDX].y) / 2.0
        face_h = abs(landmarks[CHIN_IDX].y - landmarks[FOREHEAD_IDX].y)
        if face_h < 1e-6:
            return None
        return (eye_y - eb_y) / face_h
    except (IndexError, AttributeError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
#  PALM-OPEN DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def is_palm_open(hand_landmarks) -> bool:
    """
    Return True when enough fingers are extended (fingertip above its MCP knuckle
    in image-y coordinates, i.e. tip.y < mcp.y because y=0 is top of frame).
    Only index/middle/ring/pinky are checked; thumb is skipped (unreliable).
    """
    lm = hand_landmarks.landmark
    extended = sum(
        1 for tip_idx, mcp_idx in zip(FINGER_TIPS, FINGER_MCPS)
        if lm[tip_idx].y < lm[mcp_idx].y
    )
    return extended >= PALM_OPEN_FINGERS


# ─────────────────────────────────────────────────────────────────────────────
#  STEERING
# ─────────────────────────────────────────────────────────────────────────────

def compute_steering(
    left_wrist: Tuple[float, float],
    right_wrist: Tuple[float, float],
) -> float:
    """
    Angle of the line from left wrist to right wrist relative to horizontal.
    Tilting right (right wrist lower) → positive (steer right).
    Returns a clamped value in [-1.0, 1.0].
    """
    dx = right_wrist[0] - left_wrist[0]
    dy = right_wrist[1] - left_wrist[1]
    angle_deg = math.degrees(math.atan2(dy, dx))
    return max(-1.0, min(1.0, angle_deg / MAX_TILT_DEG))


def apply_deadzone(value: float, dz: float) -> float:
    """Zero within ±dz, then rescale so output still reaches ±1.0 at extremes."""
    if abs(value) < dz:
        return 0.0
    sign = 1.0 if value > 0 else -1.0
    return sign * (abs(value) - dz) / (1.0 - dz)


# ─────────────────────────────────────────────────────────────────────────────
#  HUD DRAWING
# ─────────────────────────────────────────────────────────────────────────────

def draw_hud(
    frame: np.ndarray,
    steering: float,
    braking: bool,
    throttle_active: bool,
    hands_detected: int,
    eyebrow_ratio: Optional[float],
    eyebrow_baseline: Optional[float],
    left_pt: Optional[Tuple[int, int]],
    right_pt: Optional[Tuple[int, int]],
    w_held: bool = False,
) -> np.ndarray:
    h, w = frame.shape[:2]

    # Fist-to-fist line
    if left_pt and right_pt:
        line_color = (0, 60, 255) if braking else (0, 255, 100)
        cv2.line(frame, left_pt, right_pt, line_color, 3, cv2.LINE_AA)
        cv2.circle(frame, left_pt, 12, (255, 200, 0), -1, cv2.LINE_AA)
        cv2.circle(frame, right_pt, 12, (255, 200, 0), -1, cv2.LINE_AA)

    # Steering bar (bottom centre)
    bar_w, bar_h_px = 300, 24
    bar_x = (w - bar_w) // 2
    bar_y = h - 60
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h_px), (40, 40, 40), -1)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h_px), (100, 100, 100), 1)
    cx = bar_x + bar_w // 2
    fill = int(steering * (bar_w // 2))
    if fill >= 0:
        cv2.rectangle(frame, (cx, bar_y + 3), (cx + fill, bar_y + bar_h_px - 3), (0, 220, 80), -1)
    else:
        cv2.rectangle(frame, (cx + fill, bar_y + 3), (cx, bar_y + bar_h_px - 3), (0, 220, 80), -1)
    cv2.line(frame, (cx, bar_y), (cx, bar_y + bar_h_px), (200, 200, 200), 1)
    cv2.putText(frame, "STEER", (bar_x - 58, bar_y + 17), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (160, 160, 160), 1)
    cv2.putText(frame, f"{steering:+.2f}", (bar_x + bar_w + 8, bar_y + 17), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (160, 160, 160), 1)

    # Top-left info panel
    panel_lines = [
        (f"STEERING  {steering:+.3f}", (0, 255, 120) if abs(steering) > 0.05 else (170, 170, 170)),
        (f"HANDS     {hands_detected}/2", (0, 255, 255) if hands_detected == 2 else (0, 120, 255)),
        (f"BRAKE     {'ON ' if braking else 'off'}", (0, 80, 255) if braking else (150, 150, 150)),
        (
            f"THROTTLE  {'ON ' if throttle_active else 'off'} ({AUTO_THROTTLE_VALUE:.0%})",
            (80, 200, 255) if throttle_active else (130, 130, 130),
        ),
    ]
    if eyebrow_ratio is not None and eyebrow_baseline is not None:
        delta = eyebrow_ratio - eyebrow_baseline
        panel_lines.append((f"EYEBROW d {delta:+.3f}", (200, 150, 255)))
    if PALM_KEYS_ENABLED:
        panel_lines.append((
            f"L-PALM [W] {'HELD' if w_held else 'off '}",
            (0, 220, 255) if w_held else (140, 140, 140),
        ))

    panel_px_h = len(panel_lines) * 28 + 16
    ovl = frame.copy()
    cv2.rectangle(ovl, (8, 8), (282, 8 + panel_px_h), (15, 15, 15), -1)
    frame = cv2.addWeighted(ovl, 0.60, frame, 0.40, 0)
    for i, (text, color) in enumerate(panel_lines):
        cv2.putText(frame, text, (16, 34 + i * 28), cv2.FONT_HERSHEY_SIMPLEX, 0.58, color, 1, cv2.LINE_AA)

    # Quit hint
    cv2.putText(frame, "[Q] Quit", (w - 100, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (110, 110, 110), 1)

    return frame


# ─────────────────────────────────────────────────────────────────────────────
#  MAIN LOOP
# ─────────────────────────────────────────────────────────────────────────────

def probe_cameras():
    cameras = []
    import cv2
    import json
    for i in range(10):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            cameras.append({"index": i, "name": f"Camera {i} ({w}x{h})"})
            cap.release()
    print(json.dumps(cameras))
    sys.exit(0)

def main() -> None:
    if args.probe_cameras:
        probe_cameras()

    log("""
+----------------------------------------------------------+
|         FIST STEERING WHEEL CONTROLLER                  |
+----------------------------------------------------------+
|  1. In your game open INPUT/CONTROLLER settings and     |
|     select the virtual Xbox 360 controller.             |
|  2. Hold BOTH FISTS up like gripping a steering wheel.  |
|  3. TILT the wheel left/right to steer (analog axis).   |
|  4. RAISE EYEBROWS to brake (left trigger).             |
|  5. Open LEFT PALM to toggle W held / released.         |
|  6. Press [Q] in the camera window to quit cleanly.     |
+----------------------------------------------------------+
""")
    
    global gamepad
    log("\n[INIT] Creating virtual Xbox 360 controller via vgamepad…", verbose_only=True)
    try:
        import vgamepad as vg
        gamepad = vg.VX360Gamepad()
    except Exception as exc:
        log(f"\n[ERROR] Could not create virtual gamepad: {exc}")
        sys.exit(1)

    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        log(f"[ERROR] Cannot open camera {CAMERA_INDEX}. Change CAMERA_INDEX and retry.")
        sys.exit(1)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        min_detection_confidence=0.6,
        min_tracking_confidence=0.5,
    )
    
    face_mesh = None
    eyebrow_baseline = 0.30
    if not DISABLE_BRAKE:
        face_mesh = mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        if not BENCHMARK_MODE:
            eyebrow_baseline_res = run_calibration(cap, face_mesh)
            if eyebrow_baseline_res is None:
                log("[EXIT] Calibration aborted.")
                cap.release()
                cv2.destroyAllWindows()
                return
            eyebrow_baseline = eyebrow_baseline_res
            cv2.destroyAllWindows()

    smooth_steer = 0.0
    prev_brake = False
    prev_left_open = False
    global _w_held
    WINDOW = "Fist Steering Wheel Controller"

    log("\n[RUNNING] Tracking active. Press [Q] in the camera window to quit.\n")
    
    start_time = time.time()
    frames = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                continue

            frames += 1
            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # ── Hand tracking ─────────────────────────────────────────────────
            hand_results = hands.process(rgb)
            wrists = []          # (x_frac, y_frac, px, py, hand_lm)
            left_open = False    # open-palm state this frame

            if hand_results.multi_hand_landmarks:
                for hand_lm in hand_results.multi_hand_landmarks:
                    mp_drawing.draw_landmarks(
                        frame,
                        hand_lm,
                        mp_hands.HAND_CONNECTIONS,
                        mp_drawing_styles.get_default_hand_landmarks_style(),
                        mp_drawing_styles.get_default_hand_connections_style(),
                    )
                    w0 = hand_lm.landmark[0]  # wrist
                    wrists.append((w0.x, w0.y, int(w0.x * w), int(w0.y * h), hand_lm))

            wrists.sort(key=lambda p: p[0])   # left → right by x
            hands_detected = len(wrists)
            left_px = right_px = None

            if hands_detected >= 2:
                left_px = (wrists[0][2], wrists[0][3])
                right_px = (wrists[1][2], wrists[1][3])
                raw_steer = compute_steering(wrists[0][:2], wrists[1][:2])
                smooth_steer = SMOOTHING * smooth_steer + (1.0 - SMOOTHING) * raw_steer
            else:
                smooth_steer *= LOST_HAND_DECAY

            # ── Palm-open detection (left hand only, by screen x after flip) ──
            # After cv2.flip(frame,1): left side of screen = user's left hand
            if PALM_KEYS_ENABLED:
                for entry in wrists:
                    hand_lm = entry[4]
                    wrist_x = entry[0]  # normalised 0-1
                    if wrist_x < 0.5 and is_palm_open(hand_lm):
                        left_open = True

            # Rising-edge toggle: fire only on closed→open transition
            if PALM_KEYS_ENABLED and left_open and not prev_left_open:
                if _w_held:
                    _kb.release('w');  _w_held = False
                    log("[PALM-L] W released (toggle off)")
                else:
                    _kb.press('w');    _w_held = True
                    log("[PALM-L] W pressed  (toggle on)")
            prev_left_open = left_open

            final_steer = apply_deadzone(smooth_steer, DEADZONE)

            # ── Face / eyebrow tracking ───────────────────────────────────────
            eyebrow_ratio = None
            braking = False
            
            if not DISABLE_BRAKE and face_mesh is not None:
                face_results = face_mesh.process(rgb)
                if face_results.multi_face_landmarks:
                    lm = face_results.multi_face_landmarks[0].landmark
                    eyebrow_ratio = _eyebrow_raise_ratio(lm)
                    if eyebrow_ratio is not None:
                        braking = (eyebrow_ratio - eyebrow_baseline) > EYEBROW_RAISE_THRESHOLD

            throttle_active = AUTO_THROTTLE_ENABLED and not braking

            # ── Virtual gamepad output ────────────────────────────────────────
            gamepad.left_joystick(x_value=float_to_joystick(final_steer), y_value=0)
            gamepad.left_trigger(value=float_to_trigger(1.0 if braking else 0.0))
            gamepad.right_trigger(value=float_to_trigger(AUTO_THROTTLE_VALUE if throttle_active else 0.0))
            gamepad.update()

            if braking != prev_brake:
                log(
                    f"[BRAKE] {'ON' if braking else 'off'}"
                    f"  eyebrow={eyebrow_ratio:.4f}  baseline={eyebrow_baseline:.4f}"
                )
            prev_brake = braking

            # ── HUD / BENCHMARK ───────────────────────────────────────────────
            elapsed = time.time() - start_time
            if BENCHMARK_MODE:
                fps = frames / elapsed if elapsed > 0 else 0
                print(f"\r[BENCHMARK] FPS: {fps:.1f} | Hands: {hands_detected} | Steer: {final_steer:+.2f} | Brake: {'ON' if braking else 'OFF'} | Time: {elapsed:.1f}s", end="")
                if BENCHMARK_TIME > 0 and elapsed >= BENCHMARK_TIME:
                    print("\n[BENCHMARK] Target time reached. Exiting.")
                    break
            else:
                frame = draw_hud(
                    frame=frame,
                    steering=final_steer,
                    braking=braking,
                    throttle_active=throttle_active,
                    hands_detected=hands_detected,
                    eyebrow_ratio=eyebrow_ratio,
                    eyebrow_baseline=eyebrow_baseline,
                    left_pt=left_px,
                    right_pt=right_px,
                    w_held=_w_held,
                )
                cv2.imshow(WINDOW, frame)
                if (cv2.waitKey(1) & 0xFF) == ord('q'):
                    log("\n[EXIT] Q pressed — shutting down.")
                    break

    except KeyboardInterrupt:
        log("\n[EXIT] Interrupted.")
    except Exception:
        log("\n[ERROR] Unexpected error:")
        traceback.print_exc()
    finally:
        reset_gamepad()
        hands.close()
        if face_mesh is not None:
            face_mesh.close()
        cap.release()
        cv2.destroyAllWindows()
        log("[EXIT] Clean shutdown complete.")


if __name__ == "__main__":
    main()
