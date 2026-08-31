import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardApi } from '../api/dashboard';
import Spinner from '../components/Spinner';
import StatusBadge from '../components/StatusBadge';
import NoShowChart from '../components/NoShowChart';

function MetricCard({ icon, value, label, color }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${color}`}>{icon}</div>
      <div>
        <div className="metric-value">{value ?? '—'}</div>
        <div className="metric-label">{label}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState(null);
  const [weeks,   setWeeks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    Promise.all([dashboardApi.metrics(), dashboardApi.noShowRate()])
      .then(([m, r]) => { setMetrics(m); setWeeks(r.weeks); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <div className="page-body">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Clinic overview — updated live</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/appointments')}>
          📅 View Appointments
        </button>
      </div>

      {error && <div className="error-banner">⚠️ {error}</div>}

      {metrics && (
        <>
          <div className="metrics-grid">
            <MetricCard icon="📅" value={metrics.appointmentsToday}  label="Appointments Today"     color="blue" />
            <MetricCard icon="🛋️" value={metrics.checkedIn}          label="Checked In Right Now"   color="cyan" />
            <MetricCard icon="📋" value={metrics.upcomingConfirmed}  label="Upcoming Confirmed"     color="purple" />
            <MetricCard icon="❌" value={metrics.noShowsThisWeek}    label="No-Shows This Week"     color="red" />
          </div>

          <div className="breakdown-grid">
            <div className="card">
              <div className="card-title">By Status</div>
              {metrics.byStatus.length === 0
                ? <p className="text-muted text-sm">No data yet</p>
                : metrics.byStatus.map(s => (
                  <div key={s.status} className="breakdown-row">
                    <StatusBadge status={s.status} />
                    <span className="breakdown-count">{s.count}</span>
                  </div>
                ))
              }
            </div>

            <div className="card">
              <div className="card-title">By Provider</div>
              {metrics.byProvider.length === 0
                ? <p className="text-muted text-sm">No data yet</p>
                : metrics.byProvider.map(p => (
                  <div key={p.provider.id} className="breakdown-row">
                    <span>{p.provider.name}</span>
                    <span className="breakdown-count">{p.count}</span>
                  </div>
                ))
              }
            </div>
          </div>

          <div className="card mt-2">
            <div className="card-title">No-Show Rate — Last 8 Weeks</div>
            <NoShowChart weeks={weeks} />
          </div>
        </>
      )}
    </div>
  );
}
