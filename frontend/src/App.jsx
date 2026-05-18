import React, { useState, useEffect, useRef } from 'react';
import { Upload, AlertTriangle, ShieldCheck, Search, Activity, Camera, Cpu, Globe, Zap, History, Bell, Settings, Layers } from 'lucide-react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  transports: ['websocket', 'polling'],
  reconnectionAttempts: 5
});

function App() {
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('IDLE');
  const [videoFrame, setVideoFrame] = useState(null);
  const [weaponCount, setWeaponCount] = useState(0);
  const [faceCount, setFaceCount] = useState(0);
  const [eventLog, setEventLog] = useState([]);
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const isActiveRef = useRef(false);
  const isProcessingFrame = useRef(false);
  const fileInputRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const webcamFrameId = useRef(null);

  useEffect(() => {
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('video_frame', (data) => {
      setVideoFrame(`data:image/jpeg;base64,${data.image}`);
      setStatus(data.status);
      setWeaponCount(data.weapon_count || 0);
      setFaceCount(data.face_count || 0);

      // Mark current frame as done and request next one if webcam is active
      isProcessingFrame.current = false;
      if (isActiveRef.current) {
        requestAnimationFrame(captureWebcamFrame);
      }

      // Generate an alert card if status is above secure
      if (['THREAT DETECTED', 'CRITICAL', 'ELEVATED'].includes(data.status)) {
        setEventLog(prev => {
          const lastEvent = prev[0];
          if (lastEvent?.status === data.status && (Date.now() - lastEvent.id < 2000)) {
            return prev; // Don't spam identical alerts too quickly
          }
          const newEvent = {
            id: Date.now(),
            time: new Date().toLocaleTimeString([], { hour12: false }),
            status: data.status,
            weapons: data.weapon_count || 0,
            faces: data.face_count || 0
          };
          return [newEvent, ...prev].slice(0, 10); // Keep only last 10 for simplicity
        });
      }
    });

    socket.on('processing_complete', () => {
      setIsProcessing(false);
      setStatus('DONE');
    });

    socket.on('error', (data) => {
      console.error("SURVEILLANCE ERROR:", data.message);
      setIsProcessing(false);
      isProcessingFrame.current = false;
      setStatus('ERROR');
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('video_frame');
      socket.off('processing_complete');
      socket.off('error');

      // Cleanup webcam on unmount
      if (webcamFrameId.current) {
        cancelAnimationFrame(webcamFrameId.current);
      }
      if (webcamVideoRef.current && webcamVideoRef.current.srcObject) {
        webcamVideoRef.current.srcObject.getTracks().forEach(track => {
          track.stop();
        });
      }
    };
  }, []); // Keep listeners stable, use Refs for logic

  const captureWebcamFrame = () => {
    if (!isActiveRef.current || isProcessingFrame.current) return;

    if (canvasRef.current && webcamVideoRef.current) {
      if (webcamVideoRef.current.readyState < 2) return;

      const context = canvasRef.current.getContext('2d');
      context.drawImage(webcamVideoRef.current, 0, 0, 640, 480);
      const frameData = canvasRef.current.toDataURL('image/jpeg', 0.5);

      console.log("📤 Sending frame for analysis...");
      isProcessingFrame.current = true;
      socket.emit('webcam_frame', { image: frameData });

      // Safety watchdog: if backend doesn't respond in 3s, allow next frame
      setTimeout(() => {
        if (isProcessingFrame.current) {
          console.warn("⚠️ Analysis timeout - forcing next frame");
          isProcessingFrame.current = false;
        }
      }, 3000);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setVideoFrame(null);
      setStatus('READY_FOR_ANALYSIS');
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsProcessing(true);
    setStatus('SYSTEM_BOOT');

    const formData = new FormData();
    formData.append('video', file);

    try {
      const response = await fetch('http://localhost:5000/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        socket.emit('start_processing', { filepath: data.filepath });
      } else {
        setIsProcessing(false);
        setStatus('FAILED_UPLOAD');
      }
    } catch (error) {
      console.error('Upload failed', error);
      setIsProcessing(false);
      setStatus('COMMS_FAILURE');
    }
  };

  const toggleWebcam = async () => {
    if (isActiveRef.current) {
      isActiveRef.current = false;
      setIsWebcamActive(false);
      if (webcamVideoRef.current && webcamVideoRef.current.srcObject) {
        webcamVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
        webcamVideoRef.current.srcObject = null;
      }
      setIsProcessing(false);
      isProcessingFrame.current = false;
      setStatus('IDLE');
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 }
        });
        if (webcamVideoRef.current) {
          webcamVideoRef.current.srcObject = stream;
          isActiveRef.current = true;
          setIsWebcamActive(true);
          setIsProcessing(true);
          setStatus('WEBCAM_ACTIVE');

          // Small delay to let the camera stabilize before first capture
          setTimeout(captureWebcamFrame, 800);
        }
      } catch (err) {
        console.error("Error accessing webcam: ", err);
        setStatus('WEBCAM_ERROR');
      }
    }
  };

  const getStatusDisplay = () => {
    switch (status) {
      case 'THREAT DETECTED':
        return {
          bg: 'bg-red-50 border-red-200',
          indicator: 'bg-red-600',
          text: 'text-red-700',
          icon: <AlertTriangle className="w-5 h-5 text-red-600" />,
          title: 'THREAT DETECTED',
          desc: 'Imminent Danger - Action Required'
        };
      case 'CRITICAL':
        return {
          bg: 'bg-orange-50 border-orange-200',
          indicator: 'bg-orange-500',
          text: 'text-orange-700',
          icon: <AlertTriangle className="w-5 h-5 text-orange-500" />,
          title: 'CRITICAL ALERT',
          desc: 'Potential Weapon Confirmed'
        };
      case 'ELEVATED':
        return {
          bg: 'bg-yellow-50 border-yellow-200',
          indicator: 'bg-yellow-500',
          text: 'text-yellow-700',
          icon: <Search className="w-5 h-5 text-yellow-600" />,
          title: 'ELEVATED ACTIVITY',
          desc: 'Anomalous Behavior Recorded'
        };
      case 'SECURE':
        return {
          bg: 'bg-emerald-50 border-emerald-200',
          indicator: 'bg-emerald-500',
          text: 'text-emerald-700',
          icon: <ShieldCheck className="w-5 h-5 text-emerald-600" />,
          title: 'SECURE',
          desc: 'All Clear - Nominal Status'
        };
      default:
        return {
          bg: 'bg-slate-100 border-slate-200',
          indicator: 'bg-slate-400',
          text: 'text-slate-600',
          icon: <Activity className="w-5 h-5 text-slate-500" />,
          title: 'STANDBY',
          desc: 'System Ready for Source Feed'
        };
    }
  };

  const display = getStatusDisplay();

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans selection:bg-blue-100 selection:text-blue-900">

      {/* Precision Navigation Bar */}
      <nav className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-1.5 rounded-lg text-white">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-slate-900 leading-tight">AEGIS <span className="font-normal text-slate-500 italic">Surveillance</span></h1>
            <p className="text-[9px] font-bold text-slate-400 tracking-widest uppercase">System Protocol v4.2.5</p>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="hidden md:flex items-center gap-6 text-[11px] font-bold text-slate-500">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`}></span>
              {connected ? 'LINK_ACTIVE' : 'LINK_OFFLINE'}
            </div>
            <div className="w-px h-4 bg-slate-200"></div>
            <div className="flex items-center gap-2">
              <span>LATENCY: 12ms</span>
            </div>
          </div>

          <div className={`px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest flex items-center gap-2 border transition-all duration-300 ${isProcessing ? 'bg-red-600 text-white border-red-700 shadow-md animate-pulse' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isProcessing ? 'bg-white' : 'bg-slate-400'}`}></span>
            {isProcessing ? 'LIVE_FEED' : 'SYSTEM_IDLE'}
          </div>
        </div>
      </nav>

      <main className="p-6 max-w-[1700px] mx-auto grid grid-cols-1 md:grid-cols-12 gap-8">

        {/* Main Feed Section (Col 1-9) */}
        <div className="md:col-span-8 lg:col-span-9 space-y-6">

          {/* Unified AI Analysis Window */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl relative ring-1 ring-slate-100 group transition-all">
            <div className="aspect-video bg-slate-900 flex items-center justify-center relative overflow-hidden">
              {/* Local Raw Video (shown while AI boots or if it lags) */}
              <video
                ref={webcamVideoRef}
                autoPlay
                playsInline
                className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-500 ${isWebcamActive && !videoFrame ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
              />

              {/* AI Processed Frame */}
              {videoFrame ? (
                <img src={videoFrame} alt="AI Monitor" className="w-full h-full object-contain relative z-10" />
              ) : !isWebcamActive && (
                <div className="flex flex-col items-center opacity-30 text-white relative z-0">
                  <Camera className="w-20 h-20 mb-6" />
                  <p className="text-xs font-black tracking-[0.5em] uppercase">No Video Sink Connected</p>
                </div>
              )}

              {/* Minimal HUD Overlays */}
              <div className="absolute top-6 left-6 flex items-center gap-4">
                <div className="bg-black/40 backdrop-blur-md border border-white/10 px-4 py-2 rounded-lg text-white font-mono text-xs">
                  <span className="text-white/50">CAM:</span> 01_PRO_GRID
                </div>
                {isProcessing && (
                  <div className="bg-red-600 px-3 py-1.5 rounded text-[10px] font-black text-white tracking-widest">
                    AI_ANALYSIS_MODES: [ENABLED]
                  </div>
                )}
              </div>

              {/* Data Overlay Bottom */}
              <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between pointer-events-none">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-md border border-white/5">
                    <Zap className="w-3.5 h-3.5 text-yellow-500" />
                    <span className="text-white font-bold text-xs uppercase tracking-tighter">Telemetrics: {isProcessing ? 'Operational' : 'Waiting...'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-white/40 text-[9px] font-black tracking-widest">WEAPONS</p>
                    <p className={`text-2xl font-black ${weaponCount > 0 ? 'text-red-500' : 'text-white'}`}>{weaponCount}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-white/40 text-[9px] font-black tracking-widest">FACES</p>
                    <p className="text-2xl font-black text-white">{faceCount}</p>
                  </div>
                </div>
              </div>

              {/* Subtle Scanning Overlay */}
              <div className="absolute inset-0 pointer-events-none opacity-[0.04] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDUiLz4KPC9zdmc+')]"></div>
            </div>

            {/* Controls Bar Below Monitor */}
            <div className="p-5 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="bg-slate-200 p-2 rounded-lg">
                  <Layers className="w-4 h-4 text-slate-500" />
                </div>
                <div>
                  <p className="text-xs font-black text-slate-900 tracking-tight">ANALYSIS CONFIGURATION</p>
                  <p className="text-[10px] font-medium text-slate-400">YOLOv8 Weights: weapons_best.pt</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <canvas ref={canvasRef} width="640" height="480" style={{ display: 'none' }} />

                <button
                  onClick={toggleWebcam}
                  className={`px-5 py-2.5 rounded-xl text-[11px] font-black transition-all shadow-sm flex items-center gap-2 ${isWebcamActive ? 'bg-red-100 text-red-600 border border-red-200' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                >
                  <Camera className={`w-3.5 h-3.5 ${isWebcamActive ? 'animate-pulse' : ''}`} /> {isWebcamActive ? 'STOP_WEBCAM' : 'LIVE_WEBCAM'}
                </button>

                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
                <button
                  onClick={() => fileInputRef.current.click()}
                  disabled={isProcessing}
                  className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-[11px] font-black text-slate-700 hover:bg-slate-50 transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" /> {file ? `REPLACE_: ${file.name.slice(0, 10)}` : 'SELECT_DATA_PACKET'}
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!file || isProcessing}
                  className="px-8 py-2.5 bg-blue-600 text-white rounded-xl text-[11px] font-black tracking-widest shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all flex items-center gap-2 disabled:bg-slate-200 disabled:shadow-none"
                >
                  {isProcessing ? <Zap className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  {isProcessing ? 'CALCULATING...' : 'INITIATE_BOOT'}
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* Intelligence Side Panel (Col 10-12) */}
        <div className="md:col-span-4 lg:col-span-3 flex flex-col gap-8">

          {/* Modern Status Banner */}
          <div className={`p-6 rounded-2xl border transition-all duration-500 ${display.bg}`}>
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors shadow-inner bg-white/60`}>
                {display.icon}
              </div>
              <div>
                <h3 className={`text-base font-black ${display.text} leading-none mb-1`}>{display.title}</h3>
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${display.indicator}`}></div>
                  <span className="text-[10px] font-black text-slate-400">THREAT_LEVEL: {weaponCount > 0 ? 'CRITICAL' : 'MINIMAL'}</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              {display.desc}
            </p>
          </div>

          {/* CCTV Alert Feed */}
          <div className="flex flex-col flex-grow bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden min-h-[600px]">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-600" />
                <h3 className="text-xs font-black tracking-tighter text-slate-900 uppercase">Alert_Log_Monitor</h3>
              </div>
              <span className="text-[10px] font-black px-2 py-0.5 bg-slate-100 rounded-full text-slate-500">{eventLog.length}</span>
            </div>

            <div className="flex-grow overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {eventLog.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 opacity-40">
                  <div className="bg-slate-50 p-4 rounded-full">
                    <History className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-[10px] font-bold text-slate-500">AWAITING SYSTEM DETECTIONS...</p>
                </div>
              ) : (
                eventLog.map(alert => (
                  <div key={alert.id} className="p-4 rounded-xl border border-slate-100 bg-slate-50/30 hover:bg-white hover:border-slate-200 transition-all cursor-default group">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-slate-400 tracking-tighter flex items-center gap-1.5">
                        <Activity className="w-3 h-3" /> {alert.time}
                      </span>
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-widest ${alert.status === 'THREAT DETECTED' ? 'bg-red-600 text-white' : 'bg-orange-500 text-white'}`}>
                        {alert.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-[11px] font-bold text-slate-700 leading-tight">AI confirmed target anomalous object correlation.</p>
                    <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3 opacity-60 group-hover:opacity-100 transition-opacity">
                      <div className="flex items-center gap-1 text-[9px] font-black text-slate-500">
                        <span className="w-1 h-1 rounded-full bg-red-500"></span> Weapon: {alert.weapons}
                      </div>
                      <div className="flex items-center gap-1 text-[9px] font-black text-slate-500">
                        <span className="w-1 h-1 rounded-full bg-blue-500"></span> Face: {alert.faces}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100">
              <div className="flex items-center justify-between text-[8px] font-black text-slate-400 tracking-widest uppercase">
                <span>System_Audit_: OK</span>
                <span>Active_Uptime_: 04:22:15</span>
              </div>
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}

export default App;
