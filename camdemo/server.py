"""
CrowdTrack — server.py
YOLO v8 people detection · Flask MJPEG stream + JSON count endpoint
Run: python server.py
Requires: pip install flask flask-cors ultralytics opencv-python
"""

from flask import Flask, Response, jsonify
from flask_cors import CORS
import cv2
from ultralytics import YOLO
import threading

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from the frontend

# ── Model & capture ─────────────────────────────────────────
model = YOLO("yolov8n.pt")
cap   = cv2.VideoCapture(0)

# ── Shared state (written by capture thread, read by routes) ─
_state_lock   = threading.Lock()
_latest_count = 0
_latest_frame = None   # JPEG bytes of the most recent annotated frame


def _capture_loop():
    """
    Background thread: reads webcam frames, runs YOLO inference,
    draws bounding boxes, and updates shared state.
    """
    global _latest_count, _latest_frame
    import time

    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.05)
            continue

        results = model(frame, verbose=False)

        count = 0
        for r in results:
            for box in r.boxes:
                if int(box.cls[0]) == 0:   # class 0 = person
                    count += 1
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    conf = float(box.conf[0])
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 180), 2)
                    cv2.putText(
                        frame, f"{conf:.2f}",
                        (x1, max(0, y1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 180), 1
                    )

        # People-count overlay
        cv2.putText(
            frame, f"People: {count}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 255, 80), 2
        )

        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        jpeg = buffer.tobytes()

        with _state_lock:
            _latest_count = count
            _latest_frame = jpeg


def _mjpeg_generator():
    """Yields the latest JPEG frame in multipart MJPEG format."""
    import time
    while True:
        with _state_lock:
            frame = _latest_frame

        if frame is None:
            time.sleep(0.05)
            continue

        yield (
            b'--frame\r\n'
            b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n'
        )


# ── Routes ───────────────────────────────────────────────────

@app.route('/video')
def video():
    """MJPEG stream — consumed by the <img src="..."> in the camera tab."""
    return Response(
        _mjpeg_generator(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )


@app.route('/count')
def count():
    """JSON endpoint polled by script.js every 1.5 s to update the count display."""
    with _state_lock:
        c = _latest_count
    return jsonify({'count': c})


@app.route('/health')
def health():
    """Liveness check — returns 200 OK when the server is up."""
    return jsonify({'status': 'ok'})


# ── Entry point ──────────────────────────────────────────────
if __name__ == '__main__':
    # Start capture loop as a background daemon thread
    capture_thread = threading.Thread(target=_capture_loop, daemon=True)
    capture_thread.start()

    print("\nCrowdTrack camera server starting...")
    print("  http://127.0.0.1:5000/video   — MJPEG live stream")
    print("  http://127.0.0.1:5000/count   — JSON people count")
    print("  http://127.0.0.1:5000/health  — Health check\n")

    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)