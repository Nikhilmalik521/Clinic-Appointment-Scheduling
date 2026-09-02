import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import { alertsApi } from '../api/alerts';

export default function Sidebar({ isOpen, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [alertCount, setAlertCount] = useState(0);
  const isFD = user?.role === 'front-desk';

  useEffect(() => {
    if (!isFD) return;
    const fetchCount = () => alertsApi.count().then(d => setAlertCount(d.count)).catch(() => {});
    fetchCount();
    const id = setInterval(fetchCount, 30000);
    return () => clearInterval(id);
  }, [isFD]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    onClose?.();
  }, [location.pathname]);

  const handleLogout = () => { logout(); navigate('/'); };
  const initials = user?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div className="sidebar-overlay" onClick={onClose} aria-hidden="true" />
      )}

      <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">🏥</div>
          <div className="sidebar-brand-text">
            <div>ClinicScheduler</div>
            <div className="sidebar-brand-sub">v1.0</div>
          </div>
          {/* Close button visible only on mobile */}
          <button className="sidebar-close-btn" onClick={onClose} aria-label="Close menu">✕</button>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group-label">Main</div>

          {isFD && (
            <NavLink to="/dashboard" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="nav-icon">📊</span> Dashboard
            </NavLink>
          )}

          <NavLink to="/appointments" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="nav-icon">📅</span> Appointments
          </NavLink>

          <NavLink to="/slots" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="nav-icon">🕐</span> Slots
          </NavLink>

          {isFD && (
            <>
              <div className="nav-group-label" style={{marginTop:'0.75rem'}}>Front Desk</div>
              <NavLink to="/alerts" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <span className="nav-icon">🔔</span> Alerts
                {alertCount > 0 && <span className="nav-badge">{alertCount}</span>}
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <div className="user-name">{user?.name}</div>
              <span className="user-role">{isFD ? 'Front Desk' : 'Provider'}</span>
            </div>
            <button className="logout-btn" title="Sign out" onClick={handleLogout}>↩</button>
          </div>
        </div>
      </aside>
    </>
  );
}
