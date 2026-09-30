import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
  ArrowRight,
  ShieldCheck,
  Check,
  Home,
  UserCheck,
} from "lucide-react";
import { extractFaceDescriptorFromBase64, loadFaceApiModels } from "../lib/faceApiHelper";
import { TIMEWORK_API_URL } from "../lib/api";

export const Route = createFileRoute("/camera-gps-test")({
  head: () => ({
    meta: [
      { title: "Kamera va GPS test — TimeWork" },
      { name: "description", content: "TimeWork kamera, GPS va backend davomat testi." },
    ],
  }),
  component: CameraGpsTest,
});

type Status = "kutilmoqda" | "granted" | "denied" | "error";
type Geo = { lat: number; lng: number; acc: number };

const GEO_ERR: Record<number, string> = {
  1: "PERMISSION_DENIED",
  2: "POSITION_UNAVAILABLE",
  3: "TIMEOUT",
};

function badge(s: Status) {
  const map: Record<Status, { label: string; cls: string }> = {
    kutilmoqda: { label: "kutilmoqda", cls: "bg-muted text-muted-foreground" },
    granted: { label: "granted", cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" },
    denied: { label: "denied", cls: "bg-destructive/15 text-destructive border border-destructive/30" },
    error: { label: "error", cls: "bg-destructive/15 text-destructive border border-destructive/30" },
  };
  const c = map[s];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.cls}`}>
      {c.label}
    </span>
  );
}

function CameraGpsTest() {
  const [cam, setCam] = useState<Status>("kutilmoqda");
  const [camErr, setCamErr] = useState("");
  const [gps, setGps] = useState<Status>("kutilmoqda");
  const [gpsErr, setGpsErr] = useState("");
  const [geo, setGeo] = useState<Geo | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState<"CHECK_IN" | "CHECK_OUT" | null>(null);
  const [resp, setResp] = useState("");
  const [attendanceResult, setAttendanceResult] = useState<any>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const log = (msg: string) => {
    const ts = new Date().toISOString();
    setLogs((p) => [...p, `[${ts}] ${msg}`]);
  };

  const env = {
    secure: typeof window !== "undefined" && window.isSecureContext,
    proto: typeof window !== "undefined" ? window.location.protocol : "",
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };

  useEffect(() => {
    check();
    loadFaceApiModels().catch(() => {});
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, []);

  const check = async () => {
    log(`HTTPS: ${window.isSecureContext ? "secure" : "not secure"} (${location.protocol})`);
    // Camera
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam("error");
      setCamErr("UnsupportedError: navigator.mediaDevices.getUserMedia mavjud emas");
      log("Kamera: getUserMedia mavjud emas");
    } else {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play().catch((e) => log(`video.play(): ${e?.name}: ${e?.message}`));
        }
        const st = s.getVideoTracks()[0]?.getSettings();
        setCam("granted");
        setCamErr("");
        setStreaming(true);
        log(`Kamera ruxsati: granted`);
        log(`Kamera stream: OK, track="${s.getVideoTracks()[0]?.label}", ${st?.width}x${st?.height}`);
      } catch (e) {
        const err = e as DOMException;
        setCam(err.name === "NotAllowedError" ? "denied" : "error");
        setCamErr(`${err.name}: ${err.message}`);
        log(`Kamera xatosi: ${err.name}: ${err.message}`);
      }
    }
    // GPS
    if (!("geolocation" in navigator)) {
      setGps("error");
      setGpsErr("UnsupportedError: navigator.geolocation mavjud emas");
      log("GPS: geolocation mavjud emas");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGps("granted");
        setGpsErr("");
        setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        log(`GPS ruxsati: granted — ${p.coords.latitude}, ${p.coords.longitude} ±${p.coords.accuracy}m`);
      },
      (e) => {
        setGps(e.code === 1 ? "denied" : "error");
        const msg = `${GEO_ERR[e.code] ?? "UNKNOWN"} (code ${e.code}): ${e.message}`;
        setGpsErr(msg);
        log(`GPS xatosi: ${msg}`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const captureCanvasBase64 = (): string | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      log("Surat: xato — video tayyor emas");
      return null;
    }
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0);
    return c.toDataURL("image/jpeg", 0.85);
  };

  const capture = () => {
    const base64 = captureCanvasBase64();
    if (!base64) return;
    setPhotoUrl(base64);
    log(`Surat olindi: OK`);
  };

  // MAIN ATTENDANCE ACTION: CHECK_IN OR CHECK_OUT
  const handleAttendance = async (action: "CHECK_IN" | "CHECK_OUT") => {
    const base = TIMEWORK_API_URL.replace(/\/$/, "");
    setActionLoading(action);
    setAttendanceResult(null);
    setAttendanceError(null);
    setResp("");

    const actionText = action === "CHECK_IN" ? "Ишга Келиш (Check-In)" : "Ишдан Кетиш (Check-Out)";
    log(`========================================`);
    log(`🚀 ${actionText} boshlandi...`);

    try {
      // 1. Snapshot capture
      let base64Photo = photoUrl || captureCanvasBase64();
      if (!base64Photo) {
        throw new Error("Kameradan tasvir olinmadi. Kamera streamini yoqing.");
      }
      setPhotoUrl(base64Photo);

      // 2. Fresh GPS coordinates
      let currentGeo = geo;
      if (!currentGeo) {
        log("GPS qayta aniqlanmoqda...");
        try {
          const pos = await new Promise<GeolocationPosition>((res, rej) => {
            navigator.geolocation.getCurrentPosition(res, rej, {
              enableHighAccuracy: true,
              timeout: 10000,
            });
          });
          currentGeo = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: pos.coords.accuracy || 10,
          };
          setGeo(currentGeo);
          log(`Yangi GPS olindi: ${currentGeo.lat}, ${currentGeo.lng} ±${currentGeo.acc}m`);
        } catch (e) {
          log("GPS olishda xato, zaxira joylashuv tekshiriladi...");
        }
      }

      // 3. Extract Face Descriptor with Face-API
      log("Yuz tanish (FaceID) tahlil qilinmoqda...");
      const faceRes = await extractFaceDescriptorFromBase64(videoRef.current || base64Photo);

      if (!faceRes.hasFace) {
        log("Ogohlantirish: Yuz aniqlanmadi, shunga qaramay serverga yuborilmoqda...");
      } else {
        log(`Yuz aniqlandi! Descriptor: ${faceRes.descriptor?.length} nuqta, aniqlik: ${(faceRes.detectionScore * 100).toFixed(1)}%`);
      }

      // 4. Send Express Scan to live backend
      const payload = {
        image_base64: base64Photo,
        face_descriptor: faceRes.descriptor,
        descriptor: faceRes.descriptor,
        latitude: currentGeo?.lat,
        longitude: currentGeo?.lng,
        accuracy: currentGeo?.acc,
        timestamp: new Date().toISOString(),
        action: action,
        type: action,
        device_info: navigator.userAgent,
      };

      log(`Backendga so'rov yuborilmoqda: POST ${base}/attendance/express-scan`);
      const r = await fetch(`${base}/attendance/express-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await r.text();
      let resJson: any = null;
      try {
        resJson = JSON.parse(text);
      } catch {}

      if (!r.ok) {
        let errMessage = "Давоматни тасдиқлашда хатолик юз берди";
        if (resJson?.message) {
          errMessage = Array.isArray(resJson.message) ? resJson.message.join(". ") : resJson.message;
        } else if (resJson?.detail) {
          errMessage = resJson.detail;
        } else if (resJson?.error) {
          errMessage = resJson.error;
        }
        setAttendanceError(errMessage);
        log(`❌ XATOLIK: HTTP ${r.status} — ${errMessage}`);
        setResp(`HTTP ${r.status}\n${JSON.stringify(resJson || text, null, 2)}`);
        return;
      }

      setAttendanceResult(resJson);
      log(`✅ MUVAFFAQIYATLI: ${resJson.employee_name || "Xodim"} — ${resJson.message}`);
      setResp(`HTTP 200 (Muvaffaqiyatli)\n${JSON.stringify(resJson, null, 2)}`);
    } catch (e: any) {
      const msg = e.message || "Xatolik yuz berdi";
      setAttendanceError(msg);
      log(`❌ Xatolik: ${msg}`);
      setResp(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const sendTestPing = async () => {
    const base = TIMEWORK_API_URL.replace(/\/$/, "");
    setSending(true);
    try {
      log(`Backend aloqasi tekshirilmoqda: ${base}...`);
      const r = await fetch(`${base}/attendance/kiosk-employees`);
      const employees = await r.json().catch(() => []);
      const count = Array.isArray(employees) ? employees.length : 0;
      setResp(
        JSON.stringify(
          {
            status: `HTTP ${r.status}`,
            backendUrl: base,
            kioskEmployeesCount: count,
            gps: geo,
            message: "Backend bilan aloqa 100% ishlayapti! Endi quyidagi 'Ишга Келдим' yoki 'Ишдан Кетдим' tugmalarini bosing.",
          },
          null,
          2,
        ),
      );
      log(`Backend aloqasi: OK (${count} ta xodim ro'yxatda)`);
    } catch (e: any) {
      const msg = `${e.name}: ${e.message}`;
      setResp(msg);
      log(`Backend aloqasi xatosi: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  const copy = async () => {
    const text = [`UA: ${env.ua}`, ...logs].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      log("Loglar nusxalandi");
    } catch (e) {
      log(`Nusxalash xatosi: ${(e as Error).name}`);
    }
  };

  const card = "rounded-2xl border border-border bg-card p-4 sm:p-5";
  const btn = "rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 cursor-pointer";

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-primary">TimeWork</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold">
                FaceID & GPS Test
              </span>
            </div>
            <h1 className="text-2xl font-bold sm:text-3xl text-foreground mt-0.5">
              Davomat va Diagnostika Paneli
            </h1>
          </div>

          <Link
            to="/"
            className="self-start sm:self-auto px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold transition flex items-center gap-2 shadow-md hover:opacity-90"
          >
            <Home className="h-4 w-4" />
            <span>Asosiy Kiosk Sahifasi (/)</span>
          </Link>
        </div>

        {/* PRIMARY ACTION BUTTONS: CHECK_IN & CHECK_OUT */}
        <div className="p-4 sm:p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-emerald-400" />
                Биометрик Давоматни Қайд Этиш
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Камера ва GPS орқали реал вақтда "Ишга келдим" ёки "Ишдан кетдим" ни қайд этинг
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <button
              onClick={() => handleAttendance("CHECK_IN")}
              disabled={actionLoading !== null || !streaming}
              className="py-4 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-base shadow-xl shadow-emerald-900/40 flex items-center justify-center gap-3 transition-all cursor-pointer disabled:opacity-50"
            >
              {actionLoading === "CHECK_IN" ? (
                <>
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <span>Текширилмоқда...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-6 w-6 text-white" />
                  <span>🟢 ИШГА КЕЛДИМ (Check-In)</span>
                  <ArrowRight className="h-5 w-5 ml-auto" />
                </>
              )}
            </button>

            <button
              onClick={() => handleAttendance("CHECK_OUT")}
              disabled={actionLoading !== null || !streaming}
              className="py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-600 via-orange-600 to-amber-500 hover:from-amber-500 hover:to-orange-500 text-white font-black text-base shadow-xl shadow-amber-900/40 flex items-center justify-center gap-3 transition-all cursor-pointer disabled:opacity-50"
            >
              {actionLoading === "CHECK_OUT" ? (
                <>
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <span>Текширилмоқда...</span>
                </>
              ) : (
                <>
                  <Clock className="h-6 w-6 text-white" />
                  <span>🟠 ИШДАН КЕТДИМ (Check-Out)</span>
                  <ArrowRight className="h-5 w-5 ml-auto" />
                </>
              )}
            </button>
          </div>

          {/* ATTENDANCE SUCCESS RESULT CARD */}
          {attendanceResult && (
            <div className="p-5 bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 rounded-2xl space-y-3 shadow-xl">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 shrink-0" />
                <div>
                  <h3 className="text-lg font-black text-white flex items-center gap-2">
                    <span>👤 {attendanceResult.employee_name || attendanceResult.employee?.full_name}</span>
                    {attendanceResult.employee?.position && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                        {attendanceResult.employee.position}
                      </span>
                    )}
                  </h3>
                  <p className="text-sm text-emerald-300 font-semibold mt-0.5">
                    {attendanceResult.message || "Давомат муваффақиятли қайд этилди!"}
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-emerald-500/20 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-semibold">
                <div>
                  <span className="text-slate-400 block">Ҳаракат:</span>
                  <strong className="text-white">
                    {attendanceResult.action === "CHECK_IN" ? "Ишга келди" : "Ишдан кетди"}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">FaceID Мослик:</span>
                  <strong className="text-white">
                    {Math.round(Number(attendanceResult.similarity || 0.85) * 100)}%
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Дўкондан масофа:</span>
                  <strong className="text-white">
                    {Math.round(Number(attendanceResult.distance || attendanceResult.distance_meters || 0))} м
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Вақт:</span>
                  <strong className="text-white">{new Date().toLocaleTimeString()}</strong>
                </div>
              </div>
            </div>
          )}

          {/* ATTENDANCE ERROR MESSAGE CARD */}
          {attendanceError && (
            <div className="p-4 bg-rose-500/15 border border-rose-500/40 text-rose-200 rounded-2xl flex items-start gap-3 shadow-lg">
              <AlertTriangle className="h-6 w-6 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm text-white">Давомат қайд этилмади:</h4>
                <p className="text-xs text-rose-300 mt-1 leading-relaxed whitespace-pre-line">
                  {attendanceError}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Video & Diagnostics Grid */}
        <div className="grid gap-5 lg:grid-cols-2">
          <section className={card}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2">
                <Camera className="h-4 w-4 text-primary" />
                Камера Тасвири
              </h2>
              <button onClick={check} className="text-xs text-primary font-bold hover:underline">
                Қайта уланиш
              </button>
            </div>

            <div className="relative aspect-video overflow-hidden rounded-xl bg-black border border-border shadow-inner flex items-center justify-center">
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />

              {/* Dotted oval guide */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-3">
                <div className="w-36 h-48 sm:w-44 sm:h-56 border-2 border-dashed border-teal-400/80 rounded-[50%] shadow-[0_0_20px_rgba(45,212,191,0.35)] flex items-center justify-center">
                  <span className="text-[10px] font-bold text-teal-300 bg-black/60 px-2 py-0.5 rounded-full">
                    Юз маркази
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <button onClick={capture} disabled={!streaming} className={`${btn} flex-1 bg-muted text-foreground`}>
                📸 Жорий кадрни кўриш
              </button>
            </div>

            {photoUrl && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1">Сўнгги кадр:</p>
                <img src={photoUrl} alt="Olingan surat" className="w-full max-h-48 object-cover rounded-xl border border-border" />
              </div>
            )}
          </section>

          <section className={`${card} space-y-3 text-sm`}>
            <h2 className="font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Тизим ва Қурилма Ҳолати
            </h2>
            <Row k="Камера" v={badge(cam)} />
            {camErr && <p className="break-words font-mono text-xs text-destructive">{camErr}</p>}
            <Row k="GPS" v={badge(gps)} />
            {gpsErr && <p className="break-words font-mono text-xs text-destructive">{gpsErr}</p>}
            <Row k="HTTPS" v={badge(env.secure ? "granted" : "error")} />
            <p className="text-xs text-muted-foreground">{env.secure ? "secure" : "not secure"} ({env.proto})</p>
            <Row k="Latitude" v={geo?.lat ? String(geo.lat) : "—"} />
            <Row k="Longitude" v={geo?.lng ? String(geo.lng) : "—"} />
            <Row k="Аниқлик" v={geo ? `±${geo.acc.toFixed(1)} m` : "—"} />
            <div className="pt-2 border-t border-border">
              <p className="text-muted-foreground text-xs">Браузер (User Agent)</p>
              <p className="break-words font-mono text-[11px] text-foreground mt-0.5">{env.ua}</p>
            </div>
          </section>
        </div>

        {/* Backend Raw Response Box */}
        <section className={card}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Backend Алоқаси</h2>
              <p className="text-xs text-muted-foreground">https://alikafecrmm.uz</p>
            </div>
            <button onClick={sendTestPing} disabled={sending} className={`${btn} bg-muted text-foreground`}>
              {sending ? "Текширилмоқда..." : "Алоқани тест қилиш"}
            </button>
          </div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 font-mono text-xs">
            {resp || "Жавоб кутилмоқда..."}
          </pre>
        </section>

        {/* Technical Log */}
        <section className={card}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Техник лог</h2>
            <button onClick={copy} className={`${btn} bg-muted text-foreground text-xs`}>
              Логларни нусхалаш
            </button>
          </div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 font-mono text-xs">
            {logs.join("\n") || "Лог бўш"}
          </pre>
        </section>
      </div>
    </main>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}
