import { useEffect, useState, useCallback } from 'react';
import { alertsApi } from '../api/alerts';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';

const fmt = (iso) => iso ? new Date(iso).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' }) : '—';

export default function AlertsPage() {
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(() => {
    setLoading(true); setError('');
    alertsApi.list()
      .then(d => setAlerts(d.alerts))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const dismiss = async (slotId) => {
    try {
      await alertsApi.dismiss(slotId);
      load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="page-body">
      <div className="page-header">
        <div>
          <h1 className="page-title">🔔 Unconfirmed Alerts</h1>
          <p className="page-subtitle">
            Appointments still <strong>Requested</strong> within 24 hours of scheduled time.
            Dismissed alerts reappear within the final 1 hour.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={load}>↺ Refresh</button>
      </div>

      {error && <div className="error-banner">⚠️ {error}</div>}

      {loading ? <Spinner /> : (
        alerts.length === 0
          ? <EmptyState icon="✅" title="All clear!" text="No unconfirmed appointments within the next 24 hours." />
          : alerts.map(a => (
            <div key={a.slotId} className={`alert-card${a.isCritical ? ' critical' : ''}`}>
              <div className="alert-icon">{a.isCritical ? '🚨' : '⚠️'}</div>
              <div className="alert-info">
                <div className="alert-patient">{a.patientName}</div>
                <div className="alert-meta">
                  Provider: <strong>{a.provider?.name}</strong> &nbsp;·&nbsp;
                  {fmt(a.startTime)}
                </div>
                <div className={`alert-time${a.isCritical ? ' critical' : ''}`}>
                  {a.isCritical
                    ? `🔴 CRITICAL — ${a.minutesUntilStart} min until appointment`
                    : `⏰ ${Math.round(a.minutesUntilStart / 60)}h until appointment`
                  }
                </div>
              </div>
              <div style={{flexShrink:0}}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={()=>dismiss(a.slotId)}
                  disabled={a.isCritical}
                  title={a.isCritical ? 'Cannot dismiss — within 1h critical window' : 'Dismiss this alert'}
                >
                  {a.isCritical ? '🔒 Critical' : '✕ Dismiss'}
                </button>
              </div>
            </div>
          ))
      )}
    </div>
  );
}
