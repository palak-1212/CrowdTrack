from flask import Flask, Response, jsonify
from flask_cors import CORS
import cv2
from ultralytics import YOLO

app = Flask(__name__)
CORS(app)  # Allow requests from the frontend

model = YOLO("yolov8n.pt")
cap = cv2.VideoCapture(0)

latest_count = 0  # shared state

def generate_frames():
    global latest_count
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        results = model(frame)

        count = 0
        for r in results:
            for box in r.boxes:
                if int(box.cls[0]) == 0:  # class 0 = person
                    count += 1

        latest_count = count  # update shared count

        cv2.putText(frame, f"People: {count}", (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)

        _, buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')


@app.route('/video')
def video():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/count')
def count():
    return jsonify({'count': latest_count})  # ← NEW: JSON count endpoint


if __name__ == "__main__":
    app.run(debug=True, threaded=True)  # threaded=True needed for MJPEG + JSON together