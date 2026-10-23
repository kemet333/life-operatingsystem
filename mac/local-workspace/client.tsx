import React, { Component, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/app/globals.css';
import '@/app/jarvis.css';
import Alfred from '@/app/alfred';

function LocalStatus({ failed = false }: { failed?: boolean }) {
  return <main aria-live="polite" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#090a0c', color: '#f4f4f6', fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif', padding: 28 }}>
    <div style={{ textAlign: 'center', maxWidth: 380 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-.5px', marginBottom: 12 }}>{failed ? 'No se pudo abrir tu espacio local.' : 'Abriendo tu espacio local…'}</h1>
      {failed && <>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#a1a2aa', marginBottom: 24 }}>Recarga para volver a conectar con Alfred.</p>
        <button onClick={() => window.location.reload()} style={{ background: '#f4f4f6', color: '#101113', borderRadius: 9, padding: '11px 22px', fontSize: 14 }}>Recargar</button>
      </>}
    </div>
  </main>;
}

class LocalBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <LocalStatus failed /> : this.props.children; }
}

function LocalWorkspace() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    let disposed = false;
    (async () => {
      try {
        const response = await fetch('/api/office', { cache: 'no-store', redirect: 'error', signal: controller.signal });
        if (!response.ok) throw new Error('Local office unavailable');
        const office = await response.json();
        if (!Array.isArray(office.entries) || !office.settings || typeof office.settings.focus !== 'string' || typeof office.settings.energy !== 'string') throw new Error('Invalid local office response');
        if (!disposed) setStatus('ready');
      } catch {
        if (!disposed) setStatus('failed');
      } finally {
        window.clearTimeout(timer);
      }
    })();
    return () => { disposed = true; controller.abort(); window.clearTimeout(timer); };
  }, []);
  if (status !== 'ready') return <LocalStatus failed={status === 'failed'} />;
  return <LocalBoundary><Alfred /></LocalBoundary>;
}

createRoot(document.getElementById('root')!).render(<LocalWorkspace />);
