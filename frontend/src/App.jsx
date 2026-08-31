import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import Spinner from './components/Spinner';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AppointmentsPage from './pages/AppointmentsPage';
import AppointmentDetailPage from './pages/AppointmentDetailPage';
import SlotsPage from './pages/SlotsPage';
import AlertsPage from './pages/AlertsPage';

// Protected route wrapper
function RequireAuth({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/" replace />;
  if (role && user.role !== role) return <Navigate to="/appointments" replace />;
  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;

  if (!user) return (
    <Routes>
      <Route path="*" element={<LoginPage />} />
    </Routes>
  );

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to={user.role === 'front-desk' ? '/dashboard' : '/appointments'} replace />} />
          <Route path="/dashboard" element={
            <RequireAuth role="front-desk"><DashboardPage /></RequireAuth>
          } />
          <Route path="/appointments"     element={<RequireAuth><AppointmentsPage /></RequireAuth>} />
          <Route path="/appointments/:id" element={<RequireAuth><AppointmentDetailPage /></RequireAuth>} />
          <Route path="/slots"            element={<RequireAuth><SlotsPage /></RequireAuth>} />
          <Route path="/alerts"           element={<RequireAuth role="front-desk"><AlertsPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
