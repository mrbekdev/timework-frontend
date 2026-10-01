import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useState, useEffect, useRef } from "react";
import {
  Camera,
  MapPin,
  CheckCircle2,
  Clock,
  Sparkles,
  X,
  AlertTriangle,
  UserCheck,
  RefreshCw,
  Lock,
  Zap,
  ArrowRight,
  LogIn,
  LogOut,
  DollarSign,
  Award,
  Calendar,
  User,
  Search,
  Building2,
  ChevronRight,
  ShieldCheck,
  Activity,
  SlidersHorizontal,
} from "lucide-react";

import { TIMEWORK_API_URL } from "../lib/api";
import { extractFaceDescriptorFromBase64, loadFaceApiModels } from "../lib/faceApiHelper";
import PermissionsGateModal from "../components/PermissionsGateModal";

// Polyfill for legacy Android browsers and WebViews
if (typeof navigator !== "undefined") {
  if (!navigator.mediaDevices) {
    (navigator as any).mediaDevices = {};
  }
  if (!navigator.mediaDevices.getUserMedia) {
    const legacyGUM =
      (navigator as any).getUserMedia ||
      (navigator as any).webkitGetUserMedia ||
      (navigator as any).mozGetUserMedia ||
      (navigator as any).msGetUserMedia;
    if (legacyGUM) {
      navigator.mediaDevices.getUserMedia = function (constraints) {
        return new Promise((resolve, reject) => {
          legacyGUM.call(navigator, constraints, resolve, reject);
        });
      };
    }
  }
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TimeWork — Davomat va Shaxsiy Kabinet" },
      { name: "description", content: "FaceID 2.0 AI va GPS orqali ishga keldim / ketdim avtomatik qayd qilish stansiyasi." },
    ],
  }),
  component: TimeWorkKioskPage,
});

interface Department {
  id: string;
  name: string;
}

interface Employee {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  phone?: string;
  position?: string;
  department?: Department;
  monthly_salary?: number;
  status?: string;
  faceTemplates?: any[];
  face_encodings?: any[];
  imageUrl?: string;
}

interface GpsCoords {
  lat: number;
  lng: number;
  accuracy: number;
}

interface ScanResult {
  message: string;
  similarity?: number;
  score?: number;
  match_confidence?: number;
  distance?: number;
  distance_meters?: number;
  employee_name?: string;
  employee?: {
    id?: number;
    first_name?: string;
    last_name?: string;
    full_name?: string;
    position?: string;
    department?: Department;
  };
}

interface EmpDashboard {
  monthly_late_minutes?: number;
  monthly_early_minutes?: number;
  penalty_amount?: number;
  bonus_amount?: number;
  estimated_salary?: number;
}

interface AttendanceRecord {
  id: number | string;
  date: string;
  check_in_time?: string;
  check_out_time?: string;
  status?: string;
  worked_hours?: number;
  late_minutes?: number;
}

function TimeWorkKioskPage() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDept, setSelectedDept] = useState("ALL");
  const [showEmployeeDirectory, setShowEmployeeDirectory] = useState(false);

  // Permission Flow Modal State
  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(() => {
    try {
      if (typeof window !== "undefined") {
        return localStorage.getItem("timework_permissions_allowed") !== "true";
      }
    } catch (e) {}
    return true;
  });

  // Active Scan Modal State
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [scanAction, setScanAction] = useState<"CHECK_IN" | "CHECK_OUT">("CHECK_IN");
  const [targetEmp, setTargetEmp] = useState<Employee | null>(null);

  // Camera & Location State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [gps, setGps] = useState<GpsCoords | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Employee Login & Profile State
  const [empUsername, setEmpUsername] = useState("");
  const [empPassword, setEmpPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [loggedToken, setLoggedToken] = useState(() => {
    try {
      if (typeof window !== "undefined") {
        return localStorage.getItem("timework_emp_token") || "";
      }
    } catch (e) {}
    return "";
  });
  const [loggedUserInfo, setLoggedUserInfo] = useState<any>(null);
  const [empDashboard, setEmpDashboard] = useState<EmpDashboard | null>(null);
  const [empHistory, setEmpHistory] = useState<AttendanceRecord[]>([]);

  const startingCameraRef = useRef(false);

  // Live Clock Ticker
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Pre-load employees & face-api models
  useEffect(() => {
    loadEmployees();
    loadFaceApiModels().catch(() => {});
  }, []);

  useEffect(() => {
    if (loggedToken) {
      fetchEmpDashboard(loggedToken);
    }
  }, [loggedToken]);

  const fetchIpLocationForKiosk = async (): Promise<GpsCoords | null> => {
    try {
      const res = await fetch("https://ipapi.co/json/");
      if (res.ok) {
        const data = await res.json();
        if (data.latitude && data.longitude) {
          return { lat: data.latitude, lng: data.longitude, accuracy: 100 };
        }
      }
    } catch (e) {}
    try {
      const res = await fetch("https://ip-api.com/json/?fields=lat,lon");
      if (res.ok) {
        const data = await res.json();
        if (data.lat && data.lon) {
          return { lat: data.lat, lng: data.lon, accuracy: 100 };
        }
      }
    } catch (e) {}
    return null;
  };

  const getCurrentGpsPromise = (): Promise<GpsCoords> =>
    new Promise((resolve) => {
      // Agar avvalroq GPS olingan bo'lsa, uni DARHOL (0ms) ishlatamiz!
      if (gps && gps.lat && gps.lng) {
        return resolve(gps);
      }

      if (typeof navigator === "undefined" || !navigator.geolocation) {
        fetchIpLocationForKiosk().then((ipGps) => {
          resolve(ipGps || { lat: 41.311081, lng: 69.240562, accuracy: 999 });
        });
        return;
      }
      const done = (pos: GeolocationPosition) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 10,
        });
      const fallback = () => {
        navigator.geolocation.getCurrentPosition(
          done,
          async () => {
            const ipGps = await fetchIpLocationForKiosk();
            resolve(ipGps || { lat: 41.311081, lng: 69.240562, accuracy: 999 });
          },
          { enableHighAccuracy: false, timeout: 3000, maximumAge: 300000 },
        );
      };
      navigator.geolocation.getCurrentPosition(done, fallback, {
        enableHighAccuracy: true,
        timeout: 3000,
        maximumAge: 60000,
      });
    });

  const fetchGps = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      fetchIpLocationForKiosk().then((ipGps) => {
        if (ipGps) setGps(ipGps);
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 10,
        });
      },
      () => {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            setGps({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy || 30,
            }),
          async () => {
            const ipGps = await fetchIpLocationForKiosk();
            if (ipGps) setGps(ipGps);
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const loadEmployees = async () => {
    try {
      const res = await fetch(`${TIMEWORK_API_URL}/attendance/kiosk-employees`);
      if (res.ok) {
        const data = await res.json();
        setEmployees(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to load kiosk employees list:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleEmpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empUsername || !empPassword) {
      setLoginError("Илтимос, логин ва паролни киритинг.");
      return;
    }
    setLoginLoading(true);
    setLoginError(null);

    try {
      const res = await fetch(`${TIMEWORK_API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: empUsername, password: empPassword }),
      });

      if (!res.ok) {
        let msg = "Логин ёки пароль нотўғри.";
        try {
          const errData = await res.json();
          msg = errData.detail || errData.message || msg;
        } catch (_) {}
        throw new Error(msg);
      }

      const data = await res.json();
      const token = data.access_token || data.token;
      setLoggedToken(token);
      try {
        localStorage.setItem("timework_emp_token", token);
      } catch (e) {}
      fetchEmpDashboard(token);
    } catch (err: any) {
      setLoginError(err.message || "Киришда хатолик юз берди.");
    } finally {
      setLoginLoading(false);
    }
  };

  const fetchEmpDashboard = async (token: string) => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [meRes, dashRes, histRes] = await Promise.all([
        fetch(`${TIMEWORK_API_URL}/auth/me`, { headers }),
        fetch(`${TIMEWORK_API_URL}/dashboard/employee`, { headers }),
        fetch(`${TIMEWORK_API_URL}/attendance/my-history`, { headers }),
      ]);

      if (meRes.ok) setLoggedUserInfo(await meRes.json());
      if (dashRes.ok) setEmpDashboard(await dashRes.json());
      if (histRes.ok) setEmpHistory(await histRes.json());
    } catch (err) {
      console.error("Emp dashboard fetch error:", err);
    }
  };

  const handleEmpLogout = () => {
    setLoggedToken("");
    setLoggedUserInfo(null);
    setEmpDashboard(null);
    setEmpHistory([]);
    try {
      localStorage.removeItem("timework_emp_token");
    } catch (e) {}
  };

  const openScanModal = (action: "CHECK_IN" | "CHECK_OUT", emp: Employee | null = null) => {
    setScanAction(action);
    setTargetEmp(emp);
    setErrorMessage(null);
    setScanResult(null);
    setPhotoPreview(null);
    startingCameraRef.current = false;
    setIsScanOpen(true);
  };

  const startCamera = async () => {
    if (startingCameraRef.current) return;
    startingCameraRef.current = true;
    setCameraStarting(true);
    setErrorMessage(null);

    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
      await new Promise((r) => setTimeout(r, 200));
    }

    const isSecure =
      typeof window !== "undefined" &&
      (window.isSecureContext ||
        window.location.protocol === "https:" ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (!isSecure) {
        setErrorMessage(
          "⚠️ Хостингда сайт HTTP орқали очилган! Android ва Zamonaviy brauzerlar xavfsizlik sababli kamerani faqat HTTPS orqali ochadi. Sayt manzilini https:// bilan oching yoki pastdagi 'Селфи олиш' tugmasidan foydalaning.",
        );
      } else {
        setErrorMessage("Браузерингизда камера қўлланилмади. Телефон камерасидан расм туширинг.");
      }
      startingCameraRef.current = false;
      setCameraStarting(false);
      return;
    }

    let mediaStream: MediaStream | null = null;
    let lastErr: any = null;

    const constraintTiers: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: "user" } } },
      { video: { facingMode: "user" } },
      { video: { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 480 } } },
      { video: true },
    ];

    for (const constraints of constraintTiers) {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (mediaStream) break;
      } catch (err: any) {
        lastErr = err;
        if (err.name === "NotReadableError" || err.name === "TrackStartError" || err.name === "AbortError") {
          await new Promise((r) => setTimeout(r, 350));
          try {
            mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            if (mediaStream) break;
          } catch (retryErr) {
            lastErr = retryErr;
          }
        }
        if (
          err.name === "NotAllowedError" ||
          err.name === "PermissionDeniedError" ||
          err.name === "SecurityError"
        )
          break;
      }
    }

    startingCameraRef.current = false;

    if (!mediaStream) {
      setCameraStarting(false);
      const err = lastErr;
      let msg = "Камерага уланишда хатолик.";
      if (err) {
        if (
          err.name === "NotAllowedError" ||
          err.name === "PermissionDeniedError" ||
          err.name === "SecurityError"
        ) {
          msg =
            "📵 Камерага рухсат берилмади.\n\n" +
            "• macOS / Kompyuter: Агар сайтда 🔒 рухсати ёқилган бўлса-ю камера очилмаса, Mac тизим созламаларида Chrome'га рухсат берилмаган:\n" +
            "  «System Settings → Privacy & Security → Camera → Google Chrome»ни ёқинг ва Chrome'ни қайта очинг (Restart).\n\n" +
            "• Android: Телефоннинг «Созламалар → Иловалар → Chrome → Рухсатлар → Камера»ни ёқинг.\n\n" +
            "• Ёки пастдаги «ТЕЛЕФОН КАМЕРАСИДАН СЕЛФИ ТУШИРИШ» тугмасидан фойдаланинг.\n\n" +
            `(Техник хатолик: ${err.name} - ${err.message || "Permission denied"})`;
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          msg = `Камера топилмади. Қурилма камераси уланганини текширинг. (${err.name}: ${err.message || ""})`;
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError" || err.name === "AbortError") {
          msg = `⚠️ Камера банд! Бошқа иловани (Telegram, Zoom, FaceTime) ёпиб қайта уриниб кўринг. (${err.name}: ${err.message || ""})`;
        } else if (err.name === "OverconstrainedError") {
          msg = `Камера созламалари мос келмади. Қайта урининг. (${err.name}: ${err.message || ""})`;
        } else {
          msg = (err.message || msg) + ` (${err.name || "Error"})`;
        }
      }
      setErrorMessage(msg);
      return;
    }

    setStream(mediaStream);
    setCameraStarting(false);

    const attachStream = (videoEl: HTMLVideoElement | null) => {
      if (!videoEl) return;
      if (videoEl.srcObject !== mediaStream) {
        videoEl.srcObject = mediaStream;
      }
      videoEl.defaultMuted = true;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.setAttribute("playsinline", "");
      videoEl.setAttribute("webkit-playsinline", "");
      videoEl.setAttribute("x5-playsinline", "");
      videoEl.setAttribute("autoplay", "");
      videoEl.setAttribute("muted", "");

      const tryPlay = () => {
        const p = videoEl.play();
        if (p !== undefined) {
          p.catch((e) => console.warn("Video autoplay deferred:", e));
        }
      };

      if (videoEl.readyState >= 2) {
        tryPlay();
      } else {
        videoEl.onloadedmetadata = () => tryPlay();
      }
    };

    if (videoRef.current) {
      attachStream(videoRef.current);
    } else {
      setTimeout(() => attachStream(videoRef.current), 150);
    }
  };

  const closeScanModal = () => {
    startingCameraRef.current = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
    setIsScanOpen(false);
    setTargetEmp(null);
    setErrorMessage(null);
    setScanResult(null);
    setPhotoPreview(null);
  };

  useEffect(() => {
    if (isScanOpen) {
      const timer = setTimeout(() => startCamera(), 100);
      return () => clearTimeout(timer);
    } else {
      startingCameraRef.current = false;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
      }
    }
  }, [isScanOpen]);

  useEffect(() => {
    if (stream && videoRef.current && isScanOpen && !photoPreview) {
      const v = videoRef.current;
      if (v.srcObject !== stream) {
        v.srcObject = stream;
      }
      v.defaultMuted = true;
      v.muted = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.setAttribute("webkit-playsinline", "");
      v.setAttribute("x5-playsinline", "");
      v.setAttribute("autoplay", "");
      v.setAttribute("muted", "");

      const tryPlay = () => {
        const p = v.play();
        if (p !== undefined) {
          p.catch((e) => console.warn("Kiosk video autoplay deferred:", e));
        }
      };

      if (v.readyState >= 2) {
        tryPlay();
      } else {
        v.onloadedmetadata = () => tryPlay();
      }
    }
  }, [stream, isScanOpen, photoPreview]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setPhotoPreview(dataUrl);
      const img = new Image();
      img.onload = () => {
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          canvas.width = img.width || 640;
          canvas.height = img.height || 480;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
        }
      };
      img.src = dataUrl;
      setErrorMessage(null);
    };
    reader.readAsDataURL(file);
  };

  const handleScanSubmit = async () => {
    if (!canvasRef.current) {
      setErrorMessage("Расм ёки Камера тайёр эмас.");
      return;
    }

    setVerifying(true);
    setGpsLoading(true);
    setErrorMessage(null);
    setScanResult(null);

    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas Error");

      const hasLiveVideo = !photoPreview && videoRef.current && videoRef.current.videoWidth > 0;
      if (hasLiveVideo && videoRef.current) {
        const video = videoRef.current;
        let targetW = video.videoWidth || 640;
        let targetH = video.videoHeight || 480;
        const MAX_DIM = 640;
        if (targetW > MAX_DIM || targetH > MAX_DIM) {
          if (targetW > targetH) {
            targetH = Math.round((targetH * MAX_DIM) / targetW);
            targetW = MAX_DIM;
          } else {
            targetW = Math.round((targetW * MAX_DIM) / targetH);
            targetH = MAX_DIM;
          }
        }
        canvas.width = targetW;
        canvas.height = targetH;
        ctx.drawImage(video, 0, 0, targetW, targetH);
      }

      if (!canvas.width || !canvas.height) {
        throw new Error("Камерадан расм олинмади. Камера тайёр бўлишини кутинг ёки селфи юкланг.");
      }

      // 0.7 sifat bilan rasm hajmi ~50 KB bo'ladi, internetda 50ms da yuboriladi
      const base64Img = canvas.toDataURL("image/jpeg", 0.7);

      const [faceResult, freshGps] = await Promise.all([
        extractFaceDescriptorFromBase64(canvas),
        getCurrentGpsPromise(),
      ]);

      setGps(freshGps);
      setGpsLoading(false);

      if (!faceResult.hasFace) {
        throw new Error("Камерада одам юзи аниқланмади. Илтимос, юзингизни камерага тўғри тутиб қайта урининг!");
      }

      const payload = {
        image_base64: base64Img,
        cropped_face: faceResult.croppedFaceBase64 || base64Img,
        face_descriptor: faceResult.descriptor,
        latitude: freshGps.lat,
        longitude: freshGps.lng,
        accuracy: freshGps.accuracy,
        timestamp: new Date().toISOString(),
        action: scanAction,
        type: scanAction,
        employee_id: targetEmp?.id || undefined,
        device_info: typeof navigator !== "undefined" ? navigator.userAgent : "TimeWork Kiosk",
      };

      const res = await fetch(`${TIMEWORK_API_URL}/attendance/express-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let errData = "Давоматни тасдиқлашда хатолик юз берди";
        try {
          const json = await res.json();
          if (json.message) {
            errData = Array.isArray(json.message) ? json.message.join(". ") : json.message;
          } else if (json.detail) {
            errData = json.detail;
          } else if (json.error && json.error !== "Bad Request" && json.error !== "Internal Server Error") {
            errData = json.error;
          }
        } catch (_) {
          if (res.statusText && res.statusText !== "Internal Server Error") {
            errData = res.statusText;
          }
        }
        throw new Error(errData);
      }

      const resJson = await res.json();
      setScanResult(resJson);

      setTimeout(() => {
        closeScanModal();
        loadEmployees();
        if (loggedToken) fetchEmpDashboard(loggedToken);
      }, 2500);
    } catch (err: any) {
      setGpsLoading(false);
      setErrorMessage(err.message || "Давоматни тасдиқлашда хатолик юз берди.");
    } finally {
      setVerifying(false);
    }
  };

  // Formatters
  const formatTimeString = (dateTimeStr?: string) => {
    if (!dateTimeStr) return "—";
    if (typeof dateTimeStr === "string") {
      const rawTime = dateTimeStr.includes("T")
        ? dateTimeStr.split("T")[1]
        : dateTimeStr.includes(" ")
          ? dateTimeStr.split(" ")[1]
          : dateTimeStr;
      if (rawTime) {
        const parts = rawTime.split(":");
        if (parts.length >= 2) {
          const hourNum = parseInt(parts[0], 10);
          const minNum = parts[1];
          if (!isNaN(hourNum)) {
            const ampm = hourNum >= 12 ? "PM" : "AM";
            const displayHour = hourNum % 12 === 0 ? 12 : hourNum % 12;
            return `${String(displayHour).padStart(2, "0")}:${minNum} ${ampm}`;
          }
        }
      }
    }
    try {
      const d = new Date(dateTimeStr);
      return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "—";
    }
  };

  const formatMinutes = (minutesNum?: number) => {
    if (!minutesNum || isNaN(minutesNum) || minutesNum <= 0) return "0 дақиқа";
    const hrs = Math.floor(minutesNum / 60);
    const mins = minutesNum % 60;
    if (hrs === 0) return `${mins} дақиқа`;
    if (mins === 0) return `${hrs} соат`;
    return `${hrs} соат ${mins} дақиқа`;
  };

  const formatCurrency = (val?: number) => Number(val || 0).toLocaleString("ru-RU") + " сўм";

  const getStatusBadge = (status?: string, lateMinutes: number = 0) => {
    const st = String(status || "").toUpperCase();
    if (st === "LATE" || Number(lateMinutes) > 0) {
      return { label: "Кечикди", bg: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
    }
    if (st === "EARLY_LEAVE") {
      return { label: "Эрта кетди", bg: "bg-sky-500/20 text-sky-300 border-sky-500/40" };
    }
    if (st === "ON_TIME" || st === "PRESENT") {
      return { label: "Ўз вақтида", bg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" };
    }
    if (st === "ABSENT") {
      return { label: "Келмади", bg: "bg-rose-500/20 text-rose-300 border-rose-500/40" };
    }
    return { label: st || "—", bg: "bg-slate-800 text-slate-400 border-slate-700" };
  };

  // Departments list from employees
  const departments = React.useMemo(() => {
    const set = new Map<string, string>();
    employees.forEach((e) => {
      if (e.department?.id && e.department?.name) {
        set.set(e.department.id, e.department.name);
      }
    });
    return Array.from(set.entries()).map(([id, name]) => ({ id, name }));
  }, [employees]);

  // Filtered employees list
  const filteredEmployees = React.useMemo(() => {
    return employees.filter((emp) => {
      const q = searchQuery.toLowerCase().trim();
      const fullName = `${emp.first_name || ""} ${emp.last_name || ""} ${emp.name || ""} ${emp.username || ""}`.toLowerCase();
      const pos = (emp.position || "").toLowerCase();
      const phone = (emp.phone || "").toLowerCase();
      const matchSearch = !q || fullName.includes(q) || pos.includes(q) || phone.includes(q);
      const matchDept = selectedDept === "ALL" || emp.department?.id === selectedDept;
      return matchSearch && matchDept;
    });
  }, [employees, searchQuery, selectedDept]);

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black text-white p-4 md:p-8 font-sans relative overflow-x-hidden flex flex-col justify-between">
      {/* Interactive Permission Flow Modal (Camera -> Location) */}
      <PermissionsGateModal
        isOpen={isPermissionsModalOpen}
        onComplete={(res) => {
          setIsPermissionsModalOpen(false);
          if (res?.gps) {
            setGps(res.gps);
          } else {
            fetchGps();
          }
        }}
        onLocationObtained={(loc) => {
          setGps(loc);
        }}
        theme="dark"
      />

      {/* Background Lighting */}
      <div className="absolute top-0 left-1/4 h-[450px] w-[500px] rounded-full bg-blue-600/10 blur-[140px] pointer-events-none"></div>
      <div className="absolute top-20 right-1/4 h-[400px] w-[450px] rounded-full bg-emerald-600/10 blur-[140px] pointer-events-none"></div>

      {/* HTTP Insecure Origin Banner for Mobile/Hosting */}
      {typeof window !== "undefined" &&
        window.location.protocol === "http:" &&
        !["localhost", "127.0.0.1"].includes(window.location.hostname) && (
          <div className="max-w-7xl mx-auto w-full mb-4 p-3 bg-amber-500/15 border border-amber-500/40 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-amber-200 text-xs shadow-lg z-20">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
              <span>
                <strong>Диққат (Android/iOS):</strong> Сайт <strong>HTTP</strong> орқали очилган. Телефон камераси ва
                GPS тўлиқ ишлаши учун сайтга <strong>HTTPS</strong> орқали кириш зарур!
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                window.location.href = window.location.href.replace(/^http:/, "https:");
              }}
              className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-extrabold rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>🔒 HTTPS га ўтиш</span>
            </button>
          </div>
        )}

      <div className="max-w-7xl mx-auto w-full space-y-8 relative z-10">
        {/* Top Header Bar */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-slate-900 via-indigo-950 to-slate-900 border border-teal-500/40 text-white shadow-2xl shadow-teal-500/10 p-2.5 overflow-hidden group">
                <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
                  <path d="M10 16 V 11 A 2 2 0 0 1 12 9 H 17" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
                  <path d="M31 9 H 36 A 2 2 0 0 1 38 11 V 16" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
                  <path d="M38 32 V 37 A 2 2 0 0 1 36 39 H 31" stroke="#14b8a6" strokeWidth="2.5" strokeLinecap="round" />
                  <path d="M17 39 H 12 A 2 2 0 0 1 10 37 V 32" stroke="#14b8a6" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx="24" cy="24" r="9" stroke="url(#logoGrad)" strokeWidth="2" fill="#030712" fillOpacity="0.7" />
                  <path d="M24 18 V 24 L 28 26.5" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="24" cy="24" r="1.5" fill="#14b8a6" />
                  <defs>
                    <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="50%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#14b8a6" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-slate-950 animate-pulse"></div>
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
                  TimeWork Давомат ва Шахсий Кабинет
                </h1>
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-gradient-to-r from-blue-500/20 to-teal-500/20 text-teal-300 border border-teal-500/30 backdrop-blur-md flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-teal-400" /> FaceID 2.0 AI Терминали
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">Ходимлар давоматини қайд этиш ва ойлик маош ҳисоботи</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Live Clock */}
            <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 text-slate-200 shadow-xl backdrop-blur-md font-mono">
              <Clock className="h-4 w-4 text-blue-400 animate-pulse" />
              <span className="font-bold text-sm text-white">
                {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>

            {/* GPS Status */}
            <div
              title={gps ? `Aniqlik: ±${Math.round(gps.accuracy)}м` : "GPS aniqlanmagan"}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl border text-xs font-bold shadow-lg ${
                !gps
                  ? "bg-slate-700/40 border-slate-600/40 text-slate-400"
                  : gps.accuracy <= 50
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : gps.accuracy <= 150
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                      : "bg-rose-500/10 border-rose-500/30 text-rose-400"
              }`}
            >
              <MapPin className="h-3.5 w-3.5" />
              <span>
                {!gps
                  ? "GPS: Aniqlanmoqda..."
                  : gps.accuracy <= 50
                    ? `GPS: ±${Math.round(gps.accuracy)}м`
                    : gps.accuracy <= 150
                      ? `GPS: ±${Math.round(gps.accuracy)}м (O'rtacha)`
                      : `GPS: ±${Math.round(gps.accuracy)}м (Паст)`}
              </span>
            </div>

            {/* Diagnostika link */}
            <Link
              to="/camera-gps-test"
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold transition shadow-md"
              title="Kamera va GPS diagnostika sahifasi"
            >
              <Activity className="h-3.5 w-3.5 text-teal-400" />
              <span className="hidden sm:inline">Diagnostika</span>
            </Link>

            {loggedToken && (
              <button
                onClick={handleEmpLogout}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-xs font-bold transition cursor-pointer"
              >
                <LogOut className="h-4 w-4" /> Чиқиш
              </button>
            )}
          </div>
        </header>

        {/* --- FEATURE 1: THE TWO MAIN SCANNER CARDS (Check-In & Check-Out) --- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Check-In Card */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-emerald-950/40 via-slate-900/80 to-slate-950 border border-emerald-500/30 p-8 shadow-2xl backdrop-blur-xl group hover:border-emerald-500/60 transition-all">
            <div className="absolute top-0 right-0 p-8 text-emerald-500/10 group-hover:text-emerald-500/20 transition-all pointer-events-none">
              <Camera className="h-40 w-40 -mr-10 -mt-10" />
            </div>

            <div className="relative z-10 space-y-6">
              <div className="flex items-center justify-between">
                <span className="px-3.5 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold tracking-wider uppercase flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Кунлик Check-In
                </span>
                <div className="h-12 w-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                  <UserCheck className="h-6 w-6" />
                </div>
              </div>

              <div>
                <h2 className="text-3xl font-black text-white tracking-tight">Ишга Келдим</h2>
                <p className="text-slate-400 text-sm mt-2 max-w-md">
                  Камерага юзингизни кўрсатиб ишга келганингизни 1 сонияда қайд этинг. Биометрик 128-d AI ва GPS
                  текширув.
                </p>
              </div>

              <button
                onClick={() => openScanModal("CHECK_IN")}
                className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-base shadow-xl shadow-emerald-900/30 flex items-center justify-center gap-3 transition-all cursor-pointer group-hover:scale-[1.01]"
              >
                <Camera className="h-5 w-5" />
                <span>Сканерни Очиш</span>
                <ArrowRight className="h-5 w-5 ml-auto" />
              </button>
            </div>
          </div>

          {/* Check-Out Card */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-amber-950/30 via-slate-900/80 to-slate-950 border border-amber-500/30 p-8 shadow-2xl backdrop-blur-xl group hover:border-amber-500/60 transition-all">
            <div className="absolute top-0 right-0 p-8 text-amber-500/10 group-hover:text-amber-500/20 transition-all pointer-events-none">
              <Clock className="h-40 w-40 -mr-10 -mt-10" />
            </div>

            <div className="relative z-10 space-y-6">
              <div className="flex items-center justify-between">
                <span className="px-3.5 py-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold tracking-wider uppercase flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-amber-400" /> Кунлик Check-Out
                </span>
                <div className="h-12 w-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                  <Clock className="h-6 w-6" />
                </div>
              </div>

              <div>
                <h2 className="text-3xl font-black text-white tracking-tight">Ишдан Кетдим</h2>
                <p className="text-slate-400 text-sm mt-2 max-w-md">
                  Иш кунининг якунида юзингизни кўрсатиб ишдан кетишни қайд этинг. Иш соатлари ва овертаймлар
                  авто-ҳисобланади.
                </p>
              </div>

              <button
                onClick={() => openScanModal("CHECK_OUT")}
                className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-600 via-orange-600 to-amber-500 hover:from-amber-500 hover:to-orange-500 text-white font-black text-base shadow-xl shadow-amber-900/30 flex items-center justify-center gap-3 transition-all cursor-pointer group-hover:scale-[1.01]"
              >
                <Camera className="h-5 w-5" />
                <span>Сканерни Очиш</span>
                <ArrowRight className="h-5 w-5 ml-auto" />
              </button>
            </div>
          </div>
        </div>

        {/* --- OPTIONAL QUICK EMPLOYEE DIRECTORY & 1:1 SCAN TOGGLE --- */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-5 backdrop-blur-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-blue-400" />
              <h3 className="font-black text-white text-base">Ходимлар Рўйхати (1:1 Аниқ Текшириш)</h3>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-bold">
                {employees.length} та ходим
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowEmployeeDirectory(!showEmployeeDirectory)}
              className="self-start sm:self-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition flex items-center gap-2 cursor-pointer"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-teal-400" />
              <span>{showEmployeeDirectory ? "Рўйхатни ёпиш" : "Рўйхатни очиш"}</span>
            </button>
          </div>

          {showEmployeeDirectory && (
            <div className="space-y-4 pt-2 border-t border-slate-800/70">
              {/* Search & Dept Filter */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Ходим исми, лавозими ёки телефон бўйича қидириш..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-2xl text-white text-xs outline-none focus:border-blue-500 transition"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
                  <button
                    onClick={() => setSelectedDept("ALL")}
                    className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                      selectedDept === "ALL"
                        ? "bg-blue-600 text-white shadow-md shadow-blue-900/30"
                        : "bg-slate-850 bg-slate-800/60 text-slate-400 hover:text-white"
                    }`}
                  >
                    Барчаси ({employees.length})
                  </button>
                  {departments.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDept(d.id)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                        selectedDept === d.id
                          ? "bg-blue-600 text-white shadow-md shadow-blue-900/30"
                          : "bg-slate-800/60 text-slate-400 hover:text-white"
                      }`}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Employee Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-80 overflow-y-auto pr-1">
                {filteredEmployees.map((emp) => {
                  const empName = emp.name || `${emp.first_name || ""} ${emp.last_name || ""}`.trim() || emp.username;
                  const initial = (emp.first_name?.[0] || emp.username?.[0] || "U").toUpperCase();

                  return (
                    <div
                      key={emp.id}
                      className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/90 hover:border-slate-700 transition flex flex-col justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-md">
                          {initial}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-xs text-white truncate">{empName}</p>
                          <p className="text-[11px] text-teal-400 truncate mt-0.5">
                            {emp.position || "Ходим"} {emp.department ? `• ${emp.department.name}` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-900">
                        <button
                          onClick={() => openScanModal("CHECK_IN", emp)}
                          className="py-1.5 px-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 font-bold text-[11px] rounded-xl transition flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Келдим</span>
                        </button>
                        <button
                          onClick={() => openScanModal("CHECK_OUT", emp)}
                          className="py-1.5 px-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 font-bold text-[11px] rounded-xl transition flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Clock className="h-3 w-3" />
                          <span>Кетдим</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
                {filteredEmployees.length === 0 && !loading && (
                  <div className="col-span-full py-8 text-center text-xs text-slate-500">
                    Ходим топилмади.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* --- FEATURE 2: EMPLOYEE LOGIN & MONTHLY PERSONAL DASHBOARD --- */}
        {!loggedToken ? (
          /* Employee Login Card */
          <div className="max-w-md mx-auto w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 bg-blue-500/10 text-blue-400 rounded-2xl border border-blue-500/20 mb-1">
                <User className="h-8 w-8" />
              </div>
              <h3 className="text-2xl font-black text-white">Ходим Профилига Кириш</h3>
              <p className="text-xs text-slate-400">
                Ой бошидан бери кечикишлар, бонуслар ва маош ҳисоботингизни кўриш учун логин қилинг
              </p>
            </div>

            {loginError && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-2xl text-xs font-bold text-center">
                {loginError}
              </div>
            )}

            <form onSubmit={handleEmpLogin} className="space-y-4 text-sm font-bold">
              <div>
                <label className="text-slate-400 text-xs block mb-1.5 uppercase">Логин (Username)</label>
                <input
                  type="text"
                  required
                  placeholder="Логинни киритинг..."
                  value={empUsername}
                  onChange={(e) => setEmpUsername(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-white outline-none focus:border-blue-500 transition"
                />
              </div>

              <div>
                <label className="text-slate-400 text-xs block mb-1.5 uppercase">Пароль</label>
                <input
                  type="password"
                  required
                  placeholder="Паролни киритинг..."
                  value={empPassword}
                  onChange={(e) => setEmpPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-white outline-none focus:border-blue-500 transition"
                />
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black rounded-2xl shadow-xl shadow-blue-900/30 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {loginLoading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
                <span>Профилга Кириш</span>
              </button>
            </form>
          </div>
        ) : (
          /* Logged In Employee Personal Monthly Dashboard */
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-teal-500 text-white font-black flex items-center justify-center text-xl shadow-xl">
                  {loggedUserInfo?.employee?.first_name?.charAt(0) ||
                    loggedUserInfo?.username?.charAt(0) ||
                    "E"}
                </div>
                <div>
                  <h3 className="text-xl font-black text-white">
                    {loggedUserInfo?.employee
                      ? `${loggedUserInfo.employee.first_name || ""} ${loggedUserInfo.employee.last_name || ""}`.trim()
                      : loggedUserInfo?.username}
                  </h3>
                  <p className="text-xs text-teal-400 font-semibold mt-0.5">
                    {loggedUserInfo?.employee?.position || "Ходим Профили"} •{" "}
                    {loggedUserInfo?.employee?.department?.name || "Умумий бўлим"}
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="text-xs font-bold text-slate-400 block">Ойлик Базавий Маош</span>
                <span className="text-xl font-black text-white">
                  {formatCurrency(loggedUserInfo?.employee?.monthly_salary || 5000000)}
                </span>
              </div>
            </div>

            {/* 4 Monthly Metrics Cards (Since 1st of Month) */}
            {empDashboard && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Monthly Late Minutes */}
                <div className="rounded-3xl bg-slate-900/80 border border-slate-800 p-5 shadow-xl backdrop-blur-xl flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase">Ой бошидан кечикиш</span>
                    <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl">
                      <Clock className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <p className="text-2xl font-black text-amber-400">
                      {formatMinutes(empDashboard.monthly_late_minutes)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">Ойнинг 1-санасидан бери умумий кечикиш</p>
                  </div>
                </div>

                {/* 2. Monthly Early Arrival / Overtime Minutes */}
                <div className="rounded-3xl bg-slate-900/80 border border-slate-800 p-5 shadow-xl backdrop-blur-xl flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase">Ой бошидан эрта келиш</span>
                    <div className="p-2 bg-teal-500/10 text-teal-400 rounded-xl">
                      <Sparkles className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <p className="text-2xl font-black text-teal-400">
                      {formatMinutes(empDashboard.monthly_early_minutes)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">Вақтли келиш ва овертайм вақтлари</p>
                  </div>
                </div>

                {/* 3. Salary Deductions (Penalty) vs Additions (Bonus) */}
                <div className="rounded-3xl bg-slate-900/80 border border-slate-800 p-5 shadow-xl backdrop-blur-xl flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase">Жарима ва Бонус</span>
                    <div className="p-2 bg-rose-500/10 text-rose-400 rounded-xl">
                      <DollarSign className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-rose-400">Жарима (-):</span>
                      <span className="text-rose-400 font-mono">
                        -{formatCurrency(empDashboard.penalty_amount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-emerald-400">Бонус (+):</span>
                      <span className="text-emerald-400 font-mono">
                        +{formatCurrency(empDashboard.bonus_amount)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. Estimated Salary */}
                <div className="rounded-3xl bg-gradient-to-br from-blue-900/40 via-indigo-900/30 to-slate-900 border border-blue-500/40 p-5 shadow-xl backdrop-blur-xl flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-300 uppercase">Тахминий Маош</span>
                    <div className="p-2 bg-blue-500/20 text-blue-400 rounded-xl">
                      <Award className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <p className="text-2xl font-black text-white">
                      {formatCurrency(empDashboard.estimated_salary)}
                    </p>
                    <p className="text-[11px] text-blue-300/70 mt-1">Ишланган кунлар ва жарима/бонус инобатга олинган</p>
                  </div>
                </div>
              </div>
            )}

            {/* Attendance History Table */}
            <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-6 backdrop-blur-xl space-y-4">
              <h4 className="text-lg font-black text-white flex items-center gap-2">
                <Calendar className="h-5 w-5 text-blue-400" /> Менинг Давомат Тарихим (Ой бошидан бери)
              </h4>

              {empHistory.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">Ушбу ой учун ҳали давомат ёзувлари йўқ.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="border-b border-slate-800 text-xs font-black text-slate-400 uppercase tracking-wider">
                      <tr>
                        <th className="py-3 px-4">САНА</th>
                        <th className="py-3 px-4">КЕЛИШ ВАҚТИ</th>
                        <th className="py-3 px-4">КЕТИШ ВАҚТИ</th>
                        <th className="py-3 px-4">СТАТУС</th>
                        <th className="py-3 px-4">ИШ СОАТИ</th>
                        <th className="py-3 px-4 text-amber-400">КЕЧИКИШ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-semibold">
                      {empHistory.map((att) => {
                        const stBadge = getStatusBadge(att.status, att.late_minutes);
                        const checkInStr = formatTimeString(att.check_in_time);
                        const checkOutStr = formatTimeString(att.check_out_time);

                        return (
                          <tr key={att.id} className="hover:bg-slate-800/40 transition">
                            <td className="py-3 px-4 font-bold text-white">{String(att.date)}</td>
                            <td className="py-3 px-4 text-slate-300 font-mono">{checkInStr}</td>
                            <td className="py-3 px-4 text-slate-300 font-mono">{checkOutStr}</td>
                            <td className="py-3 px-4">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${stBadge.bg}`}>
                                {stBadge.label}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-bold text-slate-200">{att.worked_hours || 0} соат</td>
                            <td className="py-3 px-4 font-bold text-amber-400">{formatMinutes(att.late_minutes)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-12 text-center text-xs text-slate-600 border-t border-slate-900 pt-6">
        TimeWork Electronics Attendance Station • 100% Biometric Verification
      </footer>

      {/* FaceID Scan Camera Modal */}
      {isScanOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden text-white p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2 font-bold text-base">
                <Camera className="h-5 w-5 text-blue-400" />
                <span>{scanAction === "CHECK_IN" ? "Ишга Келиш (Check-In)" : "Ишдан Кетиш (Check-Out)"}</span>
              </div>
              <button
                onClick={closeScanModal}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Target Employee indicator if selected */}
            {targetEmp && (
              <div className="px-3.5 py-2 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-between text-xs text-blue-300">
                <span className="font-bold">
                  🎯 Танланган ходим: {targetEmp.first_name || targetEmp.name || targetEmp.username}
                </span>
                <button
                  type="button"
                  onClick={() => setTargetEmp(null)}
                  className="text-slate-400 hover:text-white text-[11px] underline"
                >
                  Барчаси бўйича қидириш
                </button>
              </div>
            )}

            {/* Video Viewport */}
            <div
              onClick={() => {
                if (videoRef.current && videoRef.current.paused) {
                  videoRef.current.play().catch(() => {});
                }
              }}
              className="relative aspect-[4/3] sm:aspect-video max-h-[55vh] rounded-2xl bg-black overflow-hidden border border-slate-800 flex items-center justify-center shadow-inner cursor-pointer"
              title="Камера тасвири (тўхтаб қолса босинг)"
            >
              {photoPreview ? (
                <img src={photoPreview} alt="Selfie preview" className="w-full h-full object-contain bg-black" />
              ) : (
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain bg-black" />
              )}
              <canvas ref={canvasRef} className="hidden" />

              {/* Kamera ishga tushayotganda yoki yo'q bo'lsa — Native Selfie Tugmasi va Loading */}
              {!stream && !photoPreview && (
                <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-4 gap-3 text-center z-10">
                  {cameraStarting ? (
                    <>
                      <RefreshCw className="h-9 w-9 text-teal-400 animate-spin" />
                      <p className="text-xs text-slate-300 font-semibold max-w-xs">Камера ишга туширилмоқда...</p>
                    </>
                  ) : (
                    <>
                      <Camera className="h-10 w-10 text-teal-400 animate-pulse" />
                      <p className="text-xs text-slate-300 font-semibold max-w-xs">
                        Камера очилмаса ёки Android/iPhone да бўлсангиз, пастдаги тугмани босинг:
                      </p>
                      <label className="px-5 py-3 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-bold rounded-2xl text-xs shadow-lg transition flex items-center gap-2 cursor-pointer border border-teal-400/40">
                        <Camera className="h-4 w-4" />
                        <span>📸 ТЕЛЕФОН КАМЕРАСИДАН СЕЛФИ ТУШИРИШ</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="user"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </label>
                    </>
                  )}
                </div>
              )}

              {/* Face Positioning Oval Guide */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-4">
                <div className="w-44 h-56 sm:w-52 sm:h-64 border-2 border-dashed border-teal-400/80 rounded-[50%] shadow-[0_0_25px_rgba(45,212,191,0.35)] flex flex-col items-center justify-between py-3">
                  <span className="text-[10px] font-black text-teal-300 bg-black/70 px-2.5 py-0.5 rounded-full backdrop-blur-xs tracking-tight">
                    Юзни марказга жойланг
                  </span>
                </div>
              </div>

              {(verifying || gpsLoading) && (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3 z-10">
                  <RefreshCw className="h-10 w-10 text-teal-400 animate-spin" />
                  <p className="font-bold text-sm text-white">
                    {gpsLoading && !verifying ? "📍 Joylashuv aniqlanmoqda..." : "FaceID ва GPS текширилмоқда..."}
                  </p>
                  {gps && (
                    <p className="text-[10px] text-teal-300 font-mono">
                      {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} ±{Math.round(gps.accuracy)}м
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Messages */}
            {errorMessage && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-2xl text-xs font-semibold space-y-3 whitespace-pre-line">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
                  <span className="leading-snug">{errorMessage}</span>
                </div>

                {typeof window !== "undefined" &&
                  window.location.protocol === "http:" &&
                  !["localhost", "127.0.0.1"].includes(window.location.hostname) && (
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = window.location.href.replace(/^http:/, "https:");
                      }}
                      className="w-full py-2.5 px-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <Lock className="h-4 w-4" />
                      <span>🔒 HTTPS (Хавфсиз уланиш)га ўтиш</span>
                    </button>
                  )}

                <div className="pt-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      className="flex-1 min-w-[200px] py-2.5 px-3 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-bold rounded-xl text-xs transition shadow-md flex items-center justify-center gap-2 cursor-pointer border border-teal-400/30"
                      title="Телефонда камерани очади"
                    >
                      <Camera className="h-4 w-4" />
                      <span>📸 Телефон Камерасидан Селфи Олиш</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="user"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        startingCameraRef.current = false;
                        if (stream) {
                          stream.getTracks().forEach((t) => t.stop());
                          setStream(null);
                        }
                        startCamera();
                      }}
                      className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer border border-slate-700"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Қайта уриниш</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {scanResult &&
              (() => {
                const empName =
                  scanResult.employee_name ||
                  scanResult.employee?.full_name ||
                  (scanResult.employee
                    ? `${scanResult.employee.first_name || ""} ${scanResult.employee.last_name || ""}`.trim()
                    : "");
                const scoreNum = Number(
                  scanResult.similarity ?? scanResult.score ?? scanResult.match_confidence ?? 0.85,
                );
                const scorePct = Math.round(scoreNum <= 1 ? scoreNum * 100 : scoreNum);
                const distanceNum = Number(scanResult.distance ?? scanResult.distance_meters ?? 0);

                return (
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-2xl text-sm font-bold space-y-2 shadow-lg">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-7 w-7 text-emerald-400 shrink-0" />
                      <div>
                        {empName && (
                          <p className="text-base font-black text-white flex items-center gap-2">
                            <span>👤 {empName}</span>
                            {scanResult.employee?.position && (
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                                {scanResult.employee.position}
                              </span>
                            )}
                          </p>
                        )}
                        <p className="text-xs text-emerald-200 mt-0.5 font-medium">{scanResult.message}</p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-emerald-500/20 flex items-center justify-between text-xs font-semibold text-emerald-400">
                      <span>
                        🎯 FaceID Мослик: <strong className="text-white font-bold">{scorePct}%</strong>
                      </span>
                      <span>
                        📍 Дўкондан масофа: <strong className="text-white font-bold">{distanceNum}м</strong>
                      </span>
                    </div>
                  </div>
                );
              })()}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={closeScanModal}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-sm transition cursor-pointer"
              >
                Бекор қилиш
              </button>
              <button
                onClick={handleScanSubmit}
                disabled={verifying || (!stream && !photoPreview)}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 font-bold text-sm shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Расмни Тасдиқлаш
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
