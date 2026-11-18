import './utils/polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (
  typeof window !== 'undefined' &&
  window.location.protocol === 'http:' &&
  !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(window.location.hostname)
) {
  window.location.replace(
    `https://${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}`
  );
}

try {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      void updateSW(true);
    },
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        void registration.update().catch(() => {});
      }
    },
    onRegisterError() {
      // No bloquear la app si el navegador o WebView deshabilita Service Workers
    },
  });
} catch {
  // No bloquear el render inicial si falla el registro del Service Worker
}

const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al iniciar la aplicación.';
    rootElement.innerHTML = `<div style="font-family:system-ui,sans-serif;padding:24px;max-width:460px;margin:40px auto;color:#0f172a">
      <h2 style="margin:0 0 8px;font-size:18px">No se pudo iniciar la aplicación</h2>
      <p style="margin:0 0 12px;font-size:14px;color:#475569">${msg.replace(/[<>&"]/g, '')}</p>
      <p style="margin:0;font-size:13px;color:#64748b">Probá recargar la página o actualizar el navegador de tu tablet.</p>
    </div>`;
  }
}
