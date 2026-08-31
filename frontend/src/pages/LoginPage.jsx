import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const DEMO = [
  { role: 'front-desk', label: 'Front Desk',  email: 'frontdesk@clinic.demo', password: 'Demo@1234' },
  { role: 'provider',   label: 'Dr. Smith',   email: 'smith@clinic.demo',     password: 'Demo@1234' },
  { role: 'provider',   label: 'Dr. Jones',   email: 'jones@clinic.demo',     password: 'Demo@1234' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate  = useNavigate();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const doLogin = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const user = await login(email.trim(), password);
      navigate(user.role === 'front-desk' ? '/dashboard' : '/appointments', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (d) => { setEmail(d.email); setPassword(d.password); setError(''); };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">🏥</div>
          <div className="login-logo-text">
            <h1>ClinicScheduler</h1>
            <p>Appointment Management System</p>
          </div>
        </div>

        {error && <div className="error-banner" role="alert">⚠️ {error}</div>}

        <form onSubmit={doLogin}>
          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email" type="email" autoComplete="email" autoFocus
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@clinic.com" required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password" type="password" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-lg" style={{width:'100%'}} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>

        <div className="login-divider">Quick demo login</div>

        <div className="demo-creds">
          {DEMO.map(d => (
            <button key={d.email} className="demo-cred-btn" onClick={() => fillDemo(d)}>
              <div className="demo-cred-role">{d.label}</div>
              <div className="demo-cred-email">{d.email} · Demo@1234</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
