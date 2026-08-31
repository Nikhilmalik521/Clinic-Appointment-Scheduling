import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { appointmentsApi } from '../api/appointments';
import { authApi } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import Pagination from '../components/Pagination';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';

const STATUSES = ['Requested','Confirmed','CheckedIn','Completed','NoShow','Cancelled'];

const fmt = (iso) => iso ? new Date(iso).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' }) : '—';

export default function AppointmentsPage() {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const isFD = user?.role === 'front-desk';

  const [appts,   setAppts]   = useState([]);
  const [pagination, setPagination] = useState({ total:0, page:1, pageSize:15, totalPages:1 });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Filters
  const [search,      setSearch]     = useState('');
  const [filterStatus, setStatus]    = useState('');
  const [filterProv,   setFilterProv]= useState('');
  const [dateFrom,    setDateFrom]   = useState('');
  const [dateTo,      setDateTo]     = useState('');
  const [sortBy,      setSortBy]     = useState('startTime');
  const [sortOrder,   setSortOrder]  = useState('asc');
  const [page, setPage]              = useState(1);

  // Providers list for filter dropdown (FD only)
  const [providers, setProviders] = useState([]);

  // Request appointment modal
  const [requestSlot,  setRequestSlot]  = useState(null);
  const [patientName,  setPatientName]  = useState('');
  const [reqLoading,   setReqLoading]   = useState(false);
  const [reqError,     setReqError]     = useState('');

  useEffect(() => {
    if (!isFD) return;
    // Fetch providers for filter dropdown via auth users list — we'll use slots to infer
    // Simple: load providers by calling auth me and trusting server data
  }, [isFD]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await appointmentsApi.list({
        search, status: filterStatus, providerId: filterProv,
        dateFrom, dateTo, sortBy, sortOrder,
        page, pageSize: 15,
      });
      setAppts(data.appointments);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus, filterProv, dateFrom, dateTo, sortBy, sortOrder, page]);

  useEffect(() => { setPage(1); }, [search, filterStatus, filterProv, dateFrom, dateTo, sortBy, sortOrder]);
  useEffect(() => { load(); }, [load]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortOrder('asc'); }
  };

  const sortIcon = (col) => sortBy === col ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : '';

  const doRequest = async () => {
    if (!patientName.trim()) { setReqError('Patient name is required'); return; }
    setReqLoading(true); setReqError('');
    try {
      await appointmentsApi.request(requestSlot.id, patientName.trim());
      setRequestSlot(null); setPatientName('');
      load();
    } catch (err) { setReqError(err.message); }
    finally { setReqLoading(false); }
  };

  return (
    <div className="page-body">
      <div className="page-header">
        <div>
          <h1 className="page-title">Appointments</h1>
          <p className="page-subtitle">{pagination.total} total matches</p>
        </div>
      </div>

      {/* ── Search & filters ─────────────────────────────────────────── */}
      <div className="card" style={{marginBottom:'1rem'}}>
        <div className="search-bar">
          <div className="form-group flex-1" style={{marginBottom:0}}>
            <label>Search patient</label>
            <div className="input-group">
              <span className="input-group-icon">🔍</span>
              <input placeholder="Patient name…" value={search} onChange={e=>setSearch(e.target.value)} />
            </div>
          </div>
          <div className="form-group" style={{marginBottom:0, minWidth:140}}>
            <label>Status</label>
            <select value={filterStatus} onChange={e=>setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group" style={{marginBottom:0, minWidth:130}}>
            <label>From</label>
            <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} />
          </div>
          <div className="form-group" style={{marginBottom:0, minWidth:130}}>
            <label>To</label>
            <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} />
          </div>
          <div style={{paddingTop:'1.3rem'}}>
            <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setStatus('');setFilterProv('');setDateFrom('');setDateTo('');}}>Clear</button>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">⚠️ {error}</div>}

      {loading ? <Spinner /> : (
        appts.length === 0
          ? <EmptyState icon="📭" title="No appointments found" text="Try adjusting your filters." />
          : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="sortable" onClick={()=>toggleSort('startTime')}>Date/Time{sortIcon('startTime')}</th>
                      <th>Patient</th>
                      <th className="sortable" onClick={()=>toggleSort('providerName')}>Provider{sortIcon('providerName')}</th>
                      <th className="sortable" onClick={()=>toggleSort('status')}>Status{sortIcon('status')}</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appts.map(a => (
                      <tr key={a.id} onClick={()=>navigate(`/appointments/${a.id}`)}>
                        <td>{fmt(a.startTime)}</td>
                        <td>{a.patientName || <span className="text-muted">—</span>}</td>
                        <td>{a.provider?.name}</td>
                        <td><StatusBadge status={a.status} /></td>
                        <td>{a.durationMinutes} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination {...pagination} page={page} onPage={setPage} />
            </>
          )
      )}

      {/* Request modal */}
      {requestSlot && (
        <Modal title="Request Appointment" onClose={()=>setRequestSlot(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={()=>setRequestSlot(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={doRequest} disabled={reqLoading}>{reqLoading?'Requesting…':'Confirm Request'}</button>
          </>}>
          {reqError && <div className="error-banner">{reqError}</div>}
          <div className="form-group">
            <label>Patient Name *</label>
            <input autoFocus value={patientName} onChange={e=>setPatientName(e.target.value)} placeholder="Full name" />
          </div>
        </Modal>
      )}
    </div>
  );
}
