let faceapi: any = null;
let modelsLoaded = false;
let loadingPromise: Promise<boolean> | null = null;
let detectorOptions: any = null;

const getFaceApi = async (): Promise<any> => {
  if (typeof window === 'undefined') return null;
  if (faceapi) return faceapi;
  try {
    faceapi = await import('@vladmandic/face-api');
    detectorOptions = new faceapi.TinyFaceDetectorOptions({
      inputSize: 224,
      scoreThreshold: 0.50,
    });
    return faceapi;
  } catch (err) {
    console.warn('[FaceAPI] Import error:', err);
    return null;
  }
};

export const loadFaceApiModels = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  if (modelsLoaded) return true;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const api = await getFaceApi();
      if (!api) return false;

      const MODEL_URL = '/models/face-api';
      const CDN_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

      const tryLoad = async (url: string) => {
        await Promise.all([
          api.nets.tinyFaceDetector.loadFromUri(url),
          api.nets.faceLandmark68Net.loadFromUri(url),
          api.nets.faceRecognitionNet.loadFromUri(url),
        ]);
      };

      try {
        await tryLoad(MODEL_URL);
      } catch (_) {
        await tryLoad(CDN_URL);
      }

      modelsLoaded = true;

      try {
        const warmCanvas = document.createElement('canvas');
        warmCanvas.width = 160;
        warmCanvas.height = 160;
        await api.detectSingleFace(warmCanvas, detectorOptions);
      } catch (_) {}

      return true;
    } catch (err) {
      console.warn('[FaceAPI] Failed to load models:', err);
      modelsLoaded = false;
      loadingPromise = null;
      return false;
    }
  })();

  return loadingPromise;
};

export interface FaceDescriptorResult {
  hasFace: boolean;
  descriptor: number[] | null;
  croppedFaceBase64: string | null;
  detectionScore: number;
}

export const extractFaceDescriptorFromBase64 = async (
  base64ImageOrCanvas: string | HTMLCanvasElement | HTMLVideoElement | HTMLImageElement
): Promise<FaceDescriptorResult> => {
  if (typeof window === 'undefined') {
    return { hasFace: false, descriptor: null, croppedFaceBase64: null, detectionScore: 0 };
  }

  try {
    await loadFaceApiModels();
  } catch (err) {
    console.warn('[FaceAPI] Model load error:', err);
  }

  return new Promise((resolve) => {
    try {
      if (!base64ImageOrCanvas) {
        return resolve({ hasFace: false, descriptor: null, croppedFaceBase64: null, detectionScore: 0 });
      }

      if (
        base64ImageOrCanvas instanceof HTMLCanvasElement ||
        base64ImageOrCanvas instanceof HTMLVideoElement ||
        base64ImageOrCanvas instanceof HTMLImageElement
      ) {
        runDetection(
          base64ImageOrCanvas,
          base64ImageOrCanvas instanceof HTMLCanvasElement
            ? base64ImageOrCanvas.toDataURL('image/jpeg', 0.75)
            : null,
          resolve
        );
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => runDetection(img, base64ImageOrCanvas, resolve);
      img.onerror = () =>
        resolve({ hasFace: true, descriptor: null, croppedFaceBase64: base64ImageOrCanvas, detectionScore: 0 });
      img.src = base64ImageOrCanvas;
    } catch (e) {
      resolve({
        hasFace: true,
        descriptor: null,
        croppedFaceBase64: typeof base64ImageOrCanvas === 'string' ? base64ImageOrCanvas : null,
        detectionScore: 0
      });
    }
  });
};

async function runDetection(
  source: any,
  originalBase64: string | null,
  resolve: (res: FaceDescriptorResult) => void
) {
  try {
    if (!modelsLoaded || !faceapi?.nets?.tinyFaceDetector?.params) {
      return resolve({ hasFace: true, descriptor: null, croppedFaceBase64: originalBase64, detectionScore: 1 });
    }

    const detection = await faceapi
      .detectSingleFace(source, detectorOptions)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (detection && detection.descriptor) {
      let croppedFaceBase64 = originalBase64;
      try {
        const box = detection.detection.box;
        const cropCanvas = document.createElement('canvas');
        const padding = 16;
        const startX = Math.max(0, box.x - padding);
        const startY = Math.max(0, box.y - padding);
        const sw = source.videoWidth || source.width || source.naturalWidth || 640;
        const sh = source.videoHeight || source.height || source.naturalHeight || 480;
        const cropW = Math.min(sw - startX, box.width + padding * 2);
        const cropH = Math.min(sh - startY, box.height + padding * 2);

        cropCanvas.width = 128;
        cropCanvas.height = 128;
        const ctx = cropCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(source, startX, startY, cropW, cropH, 0, 0, 128, 128);
          croppedFaceBase64 = cropCanvas.toDataURL('image/jpeg', 0.8);
        }
      } catch (_) {}

      resolve({
        hasFace: true,
        descriptor: Array.from(detection.descriptor),
        croppedFaceBase64,
        detectionScore: detection.detection.score,
      });
    } else {
      resolve({ hasFace: false, descriptor: null, croppedFaceBase64: originalBase64, detectionScore: 0 });
    }
  } catch (err) {
    console.warn('[FaceAPI] Detection error:', err);
    resolve({ hasFace: true, descriptor: null, croppedFaceBase64: originalBase64, detectionScore: 0 });
  }
}
