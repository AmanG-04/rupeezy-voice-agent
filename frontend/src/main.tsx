import React from 'react';
import ReactDOM from 'react-dom/client';
import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import ChatPage from './pages/chat';
import VoicePage from './pages/voice';
import DashboardPage from './pages/dashboard';
import { api } from './lib/apiBase';
import './index.css';

const BACKEND_WARMUP_KEY = 'rupeezy_backend_warmup_v1';

function BackendWarmup() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.sessionStorage.getItem(BACKEND_WARMUP_KEY) === '1') return;
    window.sessionStorage.setItem(BACKEND_WARMUP_KEY, '1');

    // Fire-and-forget wake-up call so Render can spin up before
    // users start interacting with chat/voice/dashboard routes.
    void fetch(api('/health'), {
      method: 'GET',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {
      // Ignore network/cold-start errors; route-level API calls
      // already handle retries and user-visible status.
    });
  }, []);

  return null;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BackendWarmup />
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/voice" element={<VoicePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
