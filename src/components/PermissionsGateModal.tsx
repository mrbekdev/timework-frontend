import React, { useState, useEffect } from 'react';
import {
  Camera,
  MapPin,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Lock,
  X,
  ChevronRight
} from 'lucide-react';

// Polyfill for legacy Android browsers and WebViews
if (typeof navigator !== 'undefined') {
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

interface PermissionsGateModalProps {
  isOpen?: boolean;
  onComplete?: (res: { camera: boolean; location: boolean; gps?: any }) => void;
  onLocationObtained?: (loc: { lat: number; lng: number; accuracy: number }) => void;
  theme?: 'dark' | 'light';
}

export default function PermissionsGateModal({
  isOpen = true,
  onComplete,
  onLocationObtained,
}: PermissionsGateModalProps) {
  const [currentStep, setCurrentStep] = useState<'checking' | 'camera' | 'location' | 'completed'>('checking');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  const [locationData, setLocationData] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

  const isSecureOrigin =
    typeof window !== 'undefined' &&
    (window.isSecureContext ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1');

  useEffect(() => {
    let isMounted = true;

    const checkExistingPermissions = async () => {
      let isCamGranted = false;
      let isLocGranted = false;

      if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
        try {
          const camStatus = await navigator.permissions.query({ name: 'camera' as any });
          if (camStatus.state === 'granted') {
            isCamGranted = true;
          }
        } catch (_) {}

        try {
          const locStatus = await navigator.permissions.query({ name: 'geolocation' as any });
          if (locStatus.state === 'granted') {
            isLocGranted = true;
          }
        } catch (_) {}
      }

      if (!isCamGranted && typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevs = devices.filter((d) => d.kind === 'videoinput');
          if (videoDevs.some((d) => d.label && d.label.length > 0)) {
            isCamGranted = true;
          }
        } catch (_) {}
      }

      const storedAuth =
        localStorage.getItem('timework_permissions_allowed') === 'true' ||
        sessionStorage.getItem('timework_permissions_allowed') === 'true';

      if ((isCamGranted && isLocGranted) || storedAuth) {
        if (!isMounted) return;
        setCameraGranted(true);
        setLocationGranted(true);

        if (navigator.geolocation && onLocationObtained) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const loc = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy || 10,
              };
              if (onLocationObtained) onLocationObtained(loc);
              if (onComplete) onComplete({ camera: true, location: true, gps: loc });
            },
            () => {
              if (onComplete) onComplete({ camera: true, location: true });
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
          );
        } else {
          if (onComplete) onComplete({ camera: true, location: true });
        }
        return;
      }

      if (isCamGranted && !isLocGranted) {
        if (!isMounted) return;
        setCameraGranted(true);
        setCurrentStep('location');
        return;
      }

      if (isMounted) {
        setCurrentStep('camera');
      }
    };

    checkExistingPermissions();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleRequestCamera = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (!isSecureOrigin) {
          throw new Error(
            'Сайт хавфсиз (HTTPS) протоколида эмас! Android ва бошқа браузерлар камера ва GPS ни фақат HTTPS орқали очишга рухсат беради.'
          );
        }
        throw new Error('Браузерингизда камерани қўллаб-қувватлаш мавжуд эмас.');
      }

      let stream: MediaStream | null = null;
      let lastErr: any = null;

      const tiers: MediaStreamConstraints[] = [
        { video: { facingMode: { ideal: 'user' } } },
        { video: { facingMode: 'user' } },
        { video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: true },
      ];

      for (const constraints of tiers) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) break;
        } catch (tierErr: any) {
          lastErr = tierErr;
          if (
            tierErr.name === 'NotReadableError' ||
            tierErr.name === 'TrackStartError' ||
            tierErr.name === 'AbortError'
          ) {
            await new Promise((r) => setTimeout(r, 350));
            try {
              stream = await navigator.mediaDevices.getUserMedia(constraints);
              if (stream) break;
            } catch (retryErr) {
              lastErr = retryErr;
            }
          }
          if (
            tierErr.name === 'NotAllowedError' ||
            tierErr.name === 'PermissionDeniedError' ||
            tierErr.name === 'SecurityError'
          ) {
            break;
          }
        }
      }

      if (!stream) {
        throw lastErr || new Error('Камерага уланиб бўлмади.');
      }

      stream.getTracks().forEach((track) => track.stop());
      await new Promise((r) => setTimeout(r, 200));

      setCameraGranted(true);
      setLoading(false);
      setCurrentStep('location');
    } catch (err: any) {
      setLoading(false);
      let msg = 'Камерага рухсат берилмади ёки блокланди.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg =
          '📵 Камерага рухсат берилмади.\n\n' +
          '• macOS: «System Settings → Privacy & Security → Camera → Google Chrome»ни ёқинг ва Chrome\'ни қайта очинг.\n' +
          '• Android: «Созламалар → Иловалар → Chrome → Рухсатлар → Камера»ни ёқинг.\n' +
          '• Браузерда: Манзил қаторидаги 🔒 белгисини босиб камерага рухсат беринг.\n' +
          `(Техник: ${err.name} - ${err.message || 'Permission denied'})`;
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'Қурилмада камера топилмади. Камера уланганини текширинг ёки «Ўтказиб юбориш» тугмасини босинг.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError' || err.name === 'AbortError') {
        msg = '⚠️ Камера банд! Telegram, WhatsApp ёки бошқа камера ишлатаётган иловаларни ёпиб қайта уриниб кўринг.';
      } else if (err.name === 'OverconstrainedError') {
        msg = 'Камера созламалари мос келмади. Қайта урининг.';
      } else if (err.message) {
        msg = err.message;
      }
      setError(msg);
    }
  };

  const handleRequestLocation = () => {
    setLoading(true);
    setError(null);

    if (!navigator.geolocation) {
      fetch('https://ipapi.co/json/')
        .then((res) => res.json())
        .then((data) => {
          if (data && data.latitude && data.longitude) {
            const loc = { lat: data.latitude, lng: data.longitude, accuracy: 100 };
            setLocationData(loc);
            if (onLocationObtained) onLocationObtained(loc);
          }
          finishFlow();
        })
        .catch(() => finishFlow());
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy || 10,
        };
        setLocationData(loc);
        setLocationGranted(true);
        setLoading(false);
        if (onLocationObtained) onLocationObtained(loc);
        finishFlow(loc);
      },
      (err) => {
        navigator.geolocation.getCurrentPosition(
          (fallbackPos) => {
            const loc = {
              lat: fallbackPos.coords.latitude,
              lng: fallbackPos.coords.longitude,
              accuracy: fallbackPos.coords.accuracy || 50,
            };
            setLocationData(loc);
            setLocationGranted(true);
            setLoading(false);
            if (onLocationObtained) onLocationObtained(loc);
            finishFlow(loc);
          },
          () => {
            setLoading(false);
            if (err.code === 1) {
              setError('Жойлашув (GPS)га рухсат берилмади. «Ўтказиб юбориш ва давом этиш» орқали давом этишингиз мумкин.');
            } else {
              finishFlow();
            }
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const handleSkipOrForceContinue = () => {
    localStorage.setItem('timework_permissions_allowed', 'true');
    sessionStorage.setItem('timework_permissions_allowed', 'true');
    if (onComplete) {
      onComplete({ camera: true, location: true, gps: locationData });
    }
  };

  const finishFlow = (loc: any = null) => {
    setCurrentStep('completed');
    localStorage.setItem('timework_permissions_allowed', 'true');
    sessionStorage.setItem('timework_permissions_allowed', 'true');
    setTimeout(() => {
      if (onComplete) {
        onComplete({ camera: true, location: true, gps: loc || locationData });
      }
    }, 600);
  };

  if (!isOpen || currentStep === 'checking') return null;

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xl select-none animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/70 rounded-3xl p-6 sm:p-8 shadow-2xl text-white overflow-hidden">
        <button
          onClick={handleSkipOrForceContinue}
          className="absolute top-5 right-5 p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
          title="Ўтказиб юбориш"
        >
          <X size={18} />
        </button>

        {/* Steps Indicator */}
        <div className="flex items-center justify-between gap-2 pb-6 border-b border-slate-800 mb-6 pr-8">
          <div className="flex items-center gap-2 flex-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all ${
                cameraGranted || currentStep === 'location' || currentStep === 'completed'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-blue-600 text-white ring-4 ring-blue-500/20 animate-pulse'
              }`}
            >
              {cameraGranted || currentStep === 'location' || currentStep === 'completed' ? (
                <CheckCircle2 size={15} />
              ) : (
                '1'
              )}
            </div>
            <span className={`text-xs font-bold truncate ${currentStep === 'camera' ? 'text-white' : 'text-slate-400'}`}>
              Камера
            </span>
          </div>

          <div className="w-8 h-0.5 bg-slate-800 rounded-full" />

          <div className="flex items-center gap-2 flex-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all ${
                locationGranted || currentStep === 'completed'
                  ? 'bg-emerald-500 text-white'
                  : currentStep === 'location'
                  ? 'bg-teal-500 text-white ring-4 ring-teal-500/20 animate-pulse'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {locationGranted || currentStep === 'completed' ? <CheckCircle2 size={15} /> : '2'}
            </div>
            <span className={`text-xs font-bold truncate ${currentStep === 'location' ? 'text-white' : 'text-slate-400'}`}>
              Жойлашув
            </span>
          </div>

          <div className="w-8 h-0.5 bg-slate-800 rounded-full" />

          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${
                currentStep === 'completed' ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              <ShieldCheck size={15} />
            </div>
          </div>
        </div>

        {/* STEP 1: CAMERA */}
        {currentStep === 'camera' && (
          <div className="space-y-6 text-center">
            <div className="relative mx-auto w-20 h-20 rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-xl shadow-blue-600/40 text-white">
              <Camera size={36} className="animate-pulse" />
            </div>

            <div className="space-y-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Lock size={12} /> 1-Босқич: Камера Хавфсизлиги
              </span>
              <h2 className="text-2xl font-black tracking-tight text-white">Камерага рухсат берасизми?</h2>
              <p className="text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
                Ходимлар юзини таниш (FaceID) ва ишга келиш/кетишни авто-қайд қилиш учун камера зарур.
              </p>
            </div>

            {!isSecureOrigin && (
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs text-left flex flex-col gap-2">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={18} className="shrink-0 text-amber-400 mt-0.5" />
                  <div className="leading-snug">
                    <strong>Диққат: Сайт HTTP орқали очилган!</strong> Android ва Chrome камера ҳамда GPS ни фақат хавфсиз <strong>HTTPS (SSL)</strong> орқали беради.
                  </div>
                </div>
                {typeof window !== 'undefined' && window.location.protocol === 'http:' && (
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = window.location.href.replace(/^http:/, 'https:');
                    }}
                    className="self-start px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Lock size={12} />
                    <span>🔒 HTTPS (Хавфсиз уланиш)га ўтиш</span>
                  </button>
                )}
              </div>
            )}

            {error && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs text-left flex items-start gap-2.5 whitespace-pre-line">
                <AlertTriangle size={18} className="shrink-0 text-rose-400 mt-0.5" />
                <div className="leading-snug">{error}</div>
              </div>
            )}

            <div className="pt-2 flex flex-col gap-2.5">
              <button
                onClick={handleRequestCamera}
                disabled={loading}
                className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-extrabold text-base shadow-lg transition flex items-center justify-center gap-2.5 disabled:opacity-70 cursor-pointer"
              >
                {loading ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    <span>Камера сўралмоқда...</span>
                  </>
                ) : (
                  <>
                    <span>Ҳа, рухсат бериш</span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleSkipOrForceContinue}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <span>Ўтказиб юбориш ва давом этиш</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: LOCATION */}
        {currentStep === 'location' && (
          <div className="space-y-6 text-center">
            <div className="relative mx-auto w-20 h-20 rounded-3xl bg-gradient-to-tr from-teal-500 to-emerald-600 flex items-center justify-center shadow-xl shadow-teal-600/40 text-white">
              <MapPin size={36} className="animate-pulse" />
            </div>

            <div className="space-y-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-teal-500/10 text-teal-400 border border-teal-500/20">
                <Lock size={12} /> 2-Босқич: Жойлашув (GPS)
              </span>
              <h2 className="text-2xl font-black tracking-tight text-white">Жойлашувга рухсат берасизми?</h2>
              <p className="text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
                Давомат қайд этилаётган дўкон гео-зонасини текшириш учун GPS рухсати зарур.
              </p>
            </div>

            {error && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs text-left flex items-start gap-2.5 whitespace-pre-line">
                <AlertTriangle size={18} className="shrink-0 text-rose-400 mt-0.5" />
                <div className="leading-snug">{error}</div>
              </div>
            )}

            <div className="pt-2 flex flex-col gap-2.5">
              <button
                onClick={handleRequestLocation}
                disabled={loading}
                className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-extrabold text-base shadow-lg transition flex items-center justify-center gap-2.5 disabled:opacity-70 cursor-pointer"
              >
                {loading ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    <span>GPS сўралмоқда...</span>
                  </>
                ) : (
                  <>
                    <span>Ҳа, рухсат бериш (GPS)</span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleSkipOrForceContinue}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <span>Ўтказиб юбориш ва давом этиш</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: COMPLETED */}
        {currentStep === 'completed' && (
          <div className="space-y-6 text-center py-6">
            <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <CheckCircle2 size={48} className="animate-bounce" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-white">Тайёр! Рухсатлар берилди</h2>
              <p className="text-sm text-slate-300">TimeWork тизимига йўналтирилмоқда...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
