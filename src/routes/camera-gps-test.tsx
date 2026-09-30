import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/camera-gps-test")({
  head: () => ({
    meta: [
      { title: "Kamera va GPS test — TimeWork" },
      { name: "description", content: "TimeWork kamera, GPS va backend diagnostika sahifasi." },
      { property: "og:title", content: "Kamera va GPS test — TimeWork" },
      { property: "og:description", content: "Brauzerlarda kamera va GPS ruxsatlarini tekshirish." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  const c =
    s === "granted"
      ? "bg-accent/20 text-accent"
      : s === "kutilmoqda"
        ? "bg-muted text-muted-foreground"
        : "bg-destructive/20 text-destructive";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c}`}>{s}</span>;
}

function CameraGpsTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cam, setCam] = useState<Status>("kutilmoqda");
  const [camErr, setCamErr] = useState("");
  const [gps, setGps] = useState<Status>("kutilmoqda");
  const [gpsErr, setGpsErr] = useState("");
  const [geo, setGeo] = useState<Geo | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [resp, setResp] = useState("");
  const [sending, setSending] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [env, setEnv] = useState({ secure: false, ua: "", proto: "" });
  const [streaming, setStreaming] = useState(false);

  const log = (m: string) =>
    setLogs((l) => [...l, `[${new Date().toISOString()}] ${m}`]);

  useEffect(() => {
    setEnv({ secure: window.isSecureContext, ua: navigator.userAgent, proto: location.protocol });
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const check = async () => {
    log(`HTTPS: ${window.isSecureContext ? "secure" : "not secure"} (${location.protocol})`);
    // Camera
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam("error");
      setCamErr("UnsupportedError: navigator.mediaDevices.getUserMedia mavjud emas (HTTPS yoki brauzer qo'llab-quvvatlamaydi)");
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

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      log("Surat: xato — video tayyor emas (videoWidth=0)");
      return;
    }
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob(
      (b) => {
        if (!b) return log("Surat: xato — toBlob null qaytardi");
        setPhoto(b);
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        setPhotoUrl(URL.createObjectURL(b));
        log(`Surat: OK, ${c.width}x${c.height}, ${(b.size / 1024).toFixed(1)} KB JPEG`);
      },
      "image/jpeg",
      0.9,
    );
  };

  const send = async () => {
    const base = import.meta.env.VITE_API_URL as string | undefined;
    if (!base) {
      const m = "VITE_API_URL sozlanmagan";
      setResp(m);
      return log(`Backend: ${m}`);
    }
    const fd = new FormData();
    if (photo) fd.append("photo", photo, "photo.jpg");
    fd.append("latitude", String(geo?.lat ?? ""));
    fd.append("longitude", String(geo?.lng ?? ""));
    fd.append("accuracy", String(geo?.acc ?? ""));
    fd.append("timestamp", new Date().toISOString());
    fd.append("userAgent", navigator.userAgent);
    const url = `${base.replace(/\/$/, "")}/camera-gps-test`;
    setSending(true);
    try {
      const r = await fetch(url, { method: "POST", body: fd });
      const text = await r.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {}
      setResp(`HTTP ${r.status}\n${body}`);
      log(`Backend: POST ${url} → HTTP ${r.status}`);
    } catch (e) {
      const err = e as Error;
      const m = `${err.name}: ${err.message} (CORS yoki tarmoq xatosi bo'lishi mumkin)`;
      setResp(m);
      log(`Backend xatosi: ${m}`);
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
  const btn = "rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50";

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <p className="text-sm font-semibold text-primary">TimeWork</p>
          <h1 className="text-2xl font-bold sm:text-3xl">Kamera va GPS diagnostikasi</h1>
        </header>

        <button onClick={check} className={`${btn} w-full bg-primary text-primary-foreground sm:w-auto`}>
          Kamera va GPS ni tekshirish
        </button>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className={card}>
            <h2 className="mb-3 font-semibold">Kamera</h2>
            <div className="aspect-video overflow-hidden rounded-xl bg-muted">
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            </div>
            <button onClick={capture} disabled={!streaming} className={`${btn} mt-3 bg-muted text-foreground`}>
              📸 Surat olish
            </button>
            {photoUrl && <img src={photoUrl} alt="Olingan surat" className="mt-3 w-full rounded-xl" />}
          </section>

          <section className={`${card} space-y-3 text-sm`}>
            <h2 className="font-semibold">Holat</h2>
            <Row k="Kamera" v={badge(cam)} />
            {camErr && <p className="break-words font-mono text-xs text-destructive">{camErr}</p>}
            <Row k="GPS" v={badge(gps)} />
            {gpsErr && <p className="break-words font-mono text-xs text-destructive">{gpsErr}</p>}
            <Row k="HTTPS" v={badge(env.secure ? "granted" : "error")} />
            <p className="text-xs text-muted-foreground">{env.secure ? "secure" : "not secure"} ({env.proto})</p>
            <Row k="Latitude" v={geo?.lat ?? "—"} />
            <Row k="Longitude" v={geo?.lng ?? "—"} />
            <Row k="Aniqlik" v={geo ? `${geo.acc.toFixed(1)} m` : "—"} />
            <div>
              <p className="text-muted-foreground">Brauzer</p>
              <p className="break-words font-mono text-xs">{env.ua}</p>
            </div>
          </section>
        </div>

        <section className={card}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Backend</h2>
            <button onClick={send} disabled={sending} className={`${btn} bg-primary text-primary-foreground`}>
              {sending ? "Yuborilmoqda..." : "Backendga yuborish"}
            </button>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 font-mono text-xs">
            {resp || "Javob yo'q"}
          </pre>
        </section>

        <section className={card}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Texnik log</h2>
            <button onClick={copy} className={`${btn} bg-muted text-foreground`}>Loglarni nusxalash</button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 font-mono text-xs">
            {logs.join("\n") || "Log bo'sh"}
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
