import time
from ultralytics import YOLO
import cv2

model = YOLO("yolov8n.pt")
cap = cv2.VideoCapture(0)

start = time.time()  # start timer

while True:
    ret, frame = cap.read()
    results = model(frame)

    count = 0
    for r in results:
        for box in r.boxes:
            if int(box.cls[0]) == 0:
                count += 1

    cv2.putText(frame, f"People: {count}", (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 1, (0,255,0), 2)

    
    # stop if ESC pressed
    if cv2.waitKey(1) == 27:
        break

    # auto-stop after 30 seconds
   # if time.time() - start > 30:
       # break

cap.release()
cv2.destroyAllWindows()