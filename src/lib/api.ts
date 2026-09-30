/**
 * TimeWork API Configuration
 * Connects to the live TimeWork backend: https://alikafecrmm.uz
 */
export const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined' && (window as any).__API_BASE_URL__) {
    return (window as any).__API_BASE_URL__;
  }
  if (import.meta.env?.VITE_API_URL) {
    return (import.meta.env.VITE_API_URL as string).replace(/\/$/, '');
  }
  if (import.meta.env?.VITE_API_BASE_URL) {
    return (import.meta.env.VITE_API_BASE_URL as string).replace(/\/$/, '');
  }
  return 'https://alikafecrmm.uz';
};

export const TIMEWORK_API_URL = getApiBaseUrl();

export default TIMEWORK_API_URL;
