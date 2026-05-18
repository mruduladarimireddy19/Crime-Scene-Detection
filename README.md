# AEGIS Surveillance System (v4.2.5)

AEGIS is a real-time AI security surveillance system that fuses custom computer vision with emotional sentiment analysis to evaluate threat levels. By correlating active weapons with human distress signs (fear, anger, sadness), the system calculates dynamic risk in real time.

---

## Technical Architecture

* **Frontend**: React (Vite), Tailwind CSS, Socket.io-client.
* **Backend**: Flask, Flask-SocketIO (Eventlet async server), OpenCV.
* **AI Models**: YOLOv8 (`weapons_best.pt` object detector) and DeepFace (behavior affect analysis).
* **Data Flow**: Hidden canvas captures `640x480` compressed webcam frames at 30 FPS, streams base64 sequences over persistent WebSockets, and receives processed overlays under 15ms.

---

## Prerequisites

Before starting, install these two free tools on your computer:
1. **Python 3.10+**: [Download Page](https://www.python.org/downloads/). *⚠️ Critical: Check the box "Add python.exe to PATH" during installation.*
2. **Node.js LTS**: [Download Page](https://nodejs.org/). Click next on all default installer options.

---

## Quick-Start Guide (Foolproof Method)

If directory navigation (`cd`) is confusing, use this explorer shortcut:
* **Windows**: Open the project folder in File Explorer, double-click into either `backend` or `frontend`, click the address bar path at the top, type **`cmd`**, and press Enter. A command prompt will pop up in that exact directory.
* **macOS**: Right-click on the `backend` or `frontend` folder, select **Services**, and click **New Terminal at Folder**.

### 1. Launch the AI Backend Server
Open a terminal in the **`backend`** folder using the shortcut, then run:

```bash
# 1. Create a virtual environment (do this once)
python -m venv venv  # If not recognized, try: python3 -m venv venv OR py -m venv venv

# 2. Activate the environment (based on your terminal):
# • Windows (Command Prompt):
venv\Scripts\activate
# • Windows (PowerShell - Run this bypass command first if blocked):
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\venv\Scripts\Activate.ps1
# • macOS / Linux:
source venv/bin/activate

# 3. Install AI libraries (takes 2-5 minutes)
pip install -r requirements.txt

# 4. Launch backend
python app.py
```
*🎉 Success look: You will see `weapons_best.pt loaded successfully`.* **Keep this window running.**

### 2. Launch the Frontend UI
Open a **new, separate terminal** in the **`frontend`** folder using the shortcut, then run:

```bash
# 1. Install packages (takes 30 seconds)
npm install

# 2. Launch the website dev server
npm run dev
```
*🎉 Success look: You will see a `http://localhost:5173` link. Open it in your web browser!*

---

## Understanding Threat Levels

The system automatically categorizes risk using the correlation engine in [compute_risk](file:///c:/capstone/backend/app.py#L32):

| Weapons Found? | Human Distress Found? | Output Risk Status | Action / Scenario |
| :--- | :--- | :--- | :--- |
| **NO** | **NO** | 🟢 **SECURE** | Everything nominal. Normal sentiments. |
| **NO** | **YES** | 🟡 **ELEVATED** | Argue/panic detected. No physical threat items. |
| **YES** | **NO** | 🟠 **CRITICAL** | Weapon detected, but environment remains calm. |
| **YES** | **YES** | 🔴 **THREAT DETECTED** | **Emergency.** Weapon present in a panicked crowd. |

---

## Quick Troubleshooting

* **"Python is not recognized"**
  * Re-run the Python installer, select **Modify**, and check the box **"Add Python to PATH"**.
* **PowerShell blocks virtual environment activation**
  * Run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process` inside PowerShell, then try activating again.
* **Webcam feed is black / not starting**
  * Close other camera-locking applications (Zoom, Teams, Skype) and refresh browser page.
* **Model loading error**
  * Confirm that `weapons_best.pt` is inside the `backend` folder next to your `app.py`.
