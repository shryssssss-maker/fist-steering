import re
with open('fist_steering.py', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace def main() to while True: loop body setup
code = re.sub(
    r'def main\(\) -> None:.*?(?=            # ── Hand tracking ─────────────────────────────────────────────────)',
    '''def probe_cameras():
    cameras = []
    import cv2
    import json
    for i in range(10):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
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

    log(
        "\\n"
        "+----------------------------------------------------------+\\n"
        "|         FIST STEERING WHEEL CONTROLLER                  |\\n"
        "+----------------------------------------------------------+\\n"
        "|  1. In your game open INPUT/CONTROLLER settings and     |\\n"
        "|     select the virtual Xbox 360 controller.             |\\n"
        "|  2. Hold BOTH FISTS up like gripping a steering wheel.  |\\n"
        "|  3. TILT the wheel left/right to steer (analog axis).   |\\n"
        "|  4. RAISE EYEBROWS to brake (left trigger).             |\\n"
        "|  5. Open LEFT PALM to toggle W held / released.         |\\n"
        "|  6. Press [Q] in the camera window to quit cleanly.     |\\n"
        "+----------------------------------------------------------+\\n"
    )
    
    global gamepad
    log("\\n[INIT] Creating virtual Xbox 360 controller via vgamepad…", verbose_only=True)
    try:
        import vgamepad as vg
        gamepad = vg.VX360Gamepad()
    except Exception as exc:
        log(f"\\n[ERROR] Could not create virtual gamepad: {exc}")
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

    log("\\n[RUNNING] Tracking active. Press [Q] in the camera window to quit.\\n")
    
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

''', code, flags=re.DOTALL)

# Handle FaceMesh conditional processing
code = code.replace('''            # ── Face / eyebrow tracking ───────────────────────────────────────
            face_results = face_mesh.process(rgb)
            eyebrow_ratio: Optional[float] = None
            braking = False

            if face_results.multi_face_landmarks:
                lm = face_results.multi_face_landmarks[0].landmark
                eyebrow_ratio = _eyebrow_raise_ratio(lm)
                if eyebrow_ratio is not None:
                    braking = (eyebrow_ratio - eyebrow_baseline) > EYEBROW_RAISE_THRESHOLD''', 
            '''            # ── Face / eyebrow tracking ───────────────────────────────────────
            eyebrow_ratio = None
            braking = False
            
            if not DISABLE_BRAKE and face_mesh is not None:
                face_results = face_mesh.process(rgb)
                if face_results.multi_face_landmarks:
                    lm = face_results.multi_face_landmarks[0].landmark
                    eyebrow_ratio = _eyebrow_raise_ratio(lm)
                    if eyebrow_ratio is not None:
                        braking = (eyebrow_ratio - eyebrow_baseline) > EYEBROW_RAISE_THRESHOLD''')

# Handle rendering/benchmarking
code = code.replace('''            # ── HUD ───────────────────────────────────────────────────────────
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
                print("\\n[EXIT] Q pressed — shutting down.")
                break''',
            '''            # ── HUD / BENCHMARK ───────────────────────────────────────────────
            elapsed = time.time() - start_time
            if BENCHMARK_MODE:
                fps = frames / elapsed if elapsed > 0 else 0
                print(f"\\r[BENCHMARK] FPS: {fps:.1f} | Hands: {hands_detected} | Steer: {final_steer:+.2f} | Brake: {'ON' if braking else 'OFF'} | Time: {elapsed:.1f}s", end="")
                if BENCHMARK_TIME > 0 and elapsed >= BENCHMARK_TIME:
                    print("\\n[BENCHMARK] Target time reached. Exiting.")
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
                    log("\\n[EXIT] Q pressed — shutting down.")
                    break''')

# replace remaining prints with logs
code = code.replace('print(', 'log(')
code = code.replace('log(f"\\r[BENCHMARK]', 'print(f"\\r[BENCHMARK]')
code = code.replace('log("\\n[BENCHMARK]', 'print("\\n[BENCHMARK]')
code = code.replace('log(json.dumps(cameras))', 'print(json.dumps(cameras))')

with open('fist_steering.py', 'w', encoding='utf-8') as f:
    f.write(code)

print("Python refactor complete.")
