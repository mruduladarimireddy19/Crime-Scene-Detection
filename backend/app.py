import os
import cv2
import base64
import numpy as np
import time
from collections import Counter
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from werkzeug.utils import secure_filename
from ultralytics import YOLO
from deepface import DeepFace

# —————————————————————————————————————————————
#  CONSTANTS (from your code.py)
# —————————————————————————————————————————————
DISTRESS_EMOTIONS = {"fear", "angry", "disgust", "sad"}

RISK_COLORS = {
    0: (0,   200,   0),   # green     – SECURE
    1: (0,   165, 255),   # orange    – ELEVATED
    2: (0,    60, 255),   # red       – CRITICAL
    3: (0,     0, 180),   # dark-red  – THREAT DETECTED
}

WEAPON_COLOR = (0,   0, 255)   # red   – weapon boxes
FACE_COLOR   = (255, 0,   0)   # blue  – face boxes

# —————————————————————————————————————————————
#  RISK ENGINE (from your code.py)
# —————————————————————————————————————————————
def compute_risk(weapons: list, faces: list) -> dict:
    weapon_present = len(weapons) > 0
    distress_faces = [f for f in faces if f["emotion"].lower() in DISTRESS_EMOTIONS]
    distress_found = len(distress_faces) > 0

    if weapon_present and distress_found:
        return {
            "level":  "THREAT DETECTED",
            "code":   3,
            "reason": "Weapon + Distress Affect Correlated"
        }
    if weapon_present and not distress_found:
        return {
            "level":  "CRITICAL",
            "code":   2,
            "reason": "Weapon Detected – Affect Nominal"
        }
    if not weapon_present and distress_found:
        return {
            "level":  "ELEVATED",
            "code":   1,
            "reason": "Distress Affect Detected – No Weapon"
        }
    return {
        "level":  "SECURE",
        "code":   0,
        "reason": "No Threat Indicators Detected"
    }

# —————————————————————————————————————————————
#  MAIN DETECTOR CLASS (from your code.py)
# —————————————————————————————————————————————
import sys

class WeaponEmotionDetector:
    def __init__(self, model_path: str):
        try:
            self.model = YOLO(model_path)
            print("✅ weapons_best.pt loaded successfully")
        except Exception as e:
            print(f"❌ CRITICAL ERROR: Unable to load {model_path}")
            print("👉 Check file path")
            sys.exit(1)
            
    def detect_weapons(self, frame) -> list:
        detections = []
        if self.model is None: return detections
        try:
            results = self.model.predict(frame, conf=0.5, verbose=False)
            for result in results:
                for box in result.boxes:
                    cls_id = int(box.cls)
                    class_name = result.names[cls_id]
                    conf = float(box.conf)
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    detections.append({
                        "box": (x1, y1, x2, y2),
                        "label": class_name,
                        "confidence": conf
                    })
        except Exception as e:
            print(f"Weapon detection error: {e}")
        return detections

    def detect_emotion(self, frame) -> list:
        faces = []
        try:
            results = DeepFace.analyze(frame, actions=["emotion"], enforce_detection=False, 
                                     detector_backend="opencv", silent=True)
            if not isinstance(results, list): results = [results]
            for res in results:
                region = res.get("region", {})
                x, y, w, h = region.get("x", 0), region.get("y", 0), region.get("w", 0), region.get("h", 0)
                emotion = res.get("dominant_emotion", "unknown")
                conf = res["emotion"].get(emotion, 0)
                faces.append({
                    "box": (x, y, x + w, y + h),
                    "emotion": emotion,
                    "confidence": conf
                })
        except Exception as e:
            print(f"Emotion detection error: {e}")
        return faces

    def draw_results(self, frame, weapons: list, faces: list, risk: dict):
        h, w = frame.shape[:2]
        color = RISK_COLORS[risk["code"]]
        for det in weapons:
            x1, y1, x2, y2 = det["box"]
            label = f"{det['label'].upper()} {det['confidence']:.0%}"
            cv2.rectangle(frame, (x1, y1), (x2, y2), WEAPON_COLOR, 2)
            cv2.putText(frame, label, (x1, max(y1-8, 14)), cv2.FONT_HERSHEY_SIMPLEX, 0.65, WEAPON_COLOR, 2)
        for face in faces:
            x1, y1, x2, y2 = face["box"]
            label = f"{face['emotion'].capitalize()} {face['confidence']:.0%}"
            cv2.rectangle(frame, (x1, y1), (x2, y2), FACE_COLOR, 2)
            cv2.putText(frame, label, (x1, max(y1-8, 14)), cv2.FONT_HERSHEY_SIMPLEX, 0.65, FACE_COLOR, 2)
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (w, 42), color, -1)
        cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)
        banner_text = f"STATUS: {risk['level']}   |   {risk['reason']}"
        cv2.putText(frame, banner_text, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.68, (255, 255, 255), 2)
        return frame

# —————————————————————————————————————————————
#  FLASK SERVER & SOCKET.IO
# —————————————————————————————————————————————
app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Fix: Initialize variables after socketio is defined
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Initialize the detector
# It will prioritize weapons_best.pt, fall back to yolov8n.pt
detector = WeaponEmotionDetector("weapons_best.pt")

@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")

def process_video_generator(video_path):
    cap = cv2.VideoCapture(video_path)
    skip_frames = 3
    frame_count = 0
    last_weapons = []
    last_faces = []
    last_risk = compute_risk([], [])

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break
        frame_count += 1
        if frame_count % skip_frames == 0:
            last_weapons = detector.detect_weapons(frame)
            last_faces = detector.detect_emotion(frame)
            last_risk = compute_risk(last_weapons, last_faces)

        annotated = detector.draw_results(frame.copy(), last_weapons, last_faces, last_risk)
        annotated = cv2.resize(annotated, (800, 600))
        _, buffer = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
        frame_data = base64.b64encode(buffer).decode('utf-8')
        
        # Yield metadata for the premium UI
        yield {
            'image': frame_data,
            'status': last_risk["level"],
            'weapon_count': len(last_weapons),
            'face_count': len(last_faces)
        }
    cap.release()

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'video' not in request.files: return jsonify({'error': 'No video'}), 400
    file = request.files['video']
    if file.filename == '': return jsonify({'error': 'No filename'}), 400
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    print(f"📁 Video saved to: {filepath}")
    return jsonify({'message': 'Uploaded', 'filepath': filepath}), 200

@socketio.on('start_processing')
def handle_start_processing(data):
    filepath = data.get('filepath')
    if not filepath or not os.path.exists(filepath):
        emit('error', {'message': 'File not found'})
        return
    print(f"▶️ Starting analysis for: {filepath}")
    for data_packet in process_video_generator(filepath):
        emit('video_frame', data_packet)
        socketio.sleep(0.01)
    print(f"✅ Analysis complete for: {filepath}")
    emit('processing_complete', {'message': 'Done'})

# Global state for webcam sessions to manage frame skipping (Matches file skip logic for zero lag)
webcam_sessions = {}

@socketio.on('webcam_frame')
def handle_webcam_frame(data):
    sid = request.sid
    if sid not in webcam_sessions:
        webcam_sessions[sid] = {
            'count': 0,
            'weapons': [],
            'faces': [],
            'risk': compute_risk([], [])
        }
    
    session = webcam_sessions[sid]
    frame_data = data.get('image')
    if not frame_data:
        return
    
    try:
        # Decode base64 image
        header, encoded = frame_data.split(",", 1) if "," in frame_data else ("", frame_data)
        img_data = base64.b64decode(encoded)
        nparr = np.frombuffer(img_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if (frame is not None):
            if session['count'] == 0:
                print("📸 Webcam stream received at backend")
            session['count'] += 1
            
            # Only run AI processing every 3rd frame to reduce lag (Matches file logic)
            if session['count'] % 2 == 0:
                session['weapons'] = detector.detect_weapons(frame)
                session['faces'] = detector.detect_emotion(frame)
                session['risk'] = compute_risk(session['weapons'], session['faces'])
            
            # Annotate every frame with the latest results for smooth visual feedback
            annotated = detector.draw_results(frame.copy(), session['weapons'], session['faces'], session['risk'])
            annotated = cv2.resize(annotated, (800, 600))
            _, buffer = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 70])
            frame_ready = base64.b64encode(buffer).decode('utf-8')
            
            emit('video_frame', {
                'image': frame_ready,
                'status': session['risk']["level"],
                'weapon_count': len(session['weapons']),
                'face_count': len(session['faces'])
            })
    except Exception as e:
        print(f"Webcam processing error: {e}")
        emit('error', {'message': str(e)})

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    if sid in webcam_sessions:
        del webcam_sessions[sid]
    print(f"Client disconnected: {sid}")

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000)
