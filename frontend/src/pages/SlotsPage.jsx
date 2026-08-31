import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { slotsApi, scheduleApi } from '../api/slots';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';

const fmt = (iso) => iso ? new Date(iso).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' }) : '—';
const toLocal = (iso) => iso ? new Date(iso).toISOString().slice(0, 16) : '';

export default function SlotsPage() {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const isFD = user?.role === 'front-desk';

  const [slots,   setSlots]   = useState([]);
  const [pagination, setPagination] = useState({ total:0, page:1, pageSize:20, totalPages:1 });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [ok,      setOk]      = useState('');
  const [page,    setPage]    = useState(1);
  const [showArchived, setShowArchived] = useState(false);

  // Create / Edit slot modal
  const [slotModal, setSlotModal] = useState(false);
  const [editSlot,  setEditSlot]  = useState(null);
  const [form, setForm] = useState({ providerId:'', startTime:'', durationMinutes:30 });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  // Bulk modal
  const [bulkModal, setBulkModal] = useState(false);
  const [bulk, setBulk] = useState({ providerId:'', startDate:'', endDate:'', startHour:9, endHour:17, durationMinutes:30, intervalMinutes:30 });
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkErr, setBulkErr] = useState('');

  // CSV export
  const [csvDate, setCsvDate] = useState(new Date().toISOString().slice(0,10));
  const [csvLoading, setCsvLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await slotsApi.list({ isArchived: showArchived, page, pageSize: 20 });
      // Backend returns slots (Available + others based on role)
      const all = data.slots ?? data.appointments ?? [];
      setSlots(all);
      if (data.pagination) setPagination(data.pagination);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [showArchived, page]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditSlot(null);
    setForm({ providerId: isFD ? '' : user.id, startTime:'', durationMinutes:30 });
    setFormErr(''); setSlotModal(true);
  };

  const openEdit = (slot) => {
    setEditSlot(slot);
    setForm({ providerId: slot.providerId, startTime: toLocal(slot.startTime), durationMinutes: slot.durationMinutes });
    setFormErr(''); setSlotModal(true);
  };

  const saveSlot = async () => {
    setSaving(true); setFormErr('');
    try {
      const body = { ...form, durationMinutes: parseInt(form.durationMinutes) };
      if (!body.providerId) body.providerId = user.id;
      if (editSlot) await slotsApi.update(editSlot.id, body);
      else          await slotsApi.create(body);
      setSlotModal(false); setOk(editSlot ? 'Slot updated.' : 'Slot created.'); load();
    } catch (err) { setFormErr(err.message); }
    finally { setSaving(false); }
  };

  const archiveSlot = async (slot) => {
    try {
      if (slot.isArchived) { await slotsApi.restore(slot.id); setOk('Slot restored.'); }
      else                  { await slotsApi.archive(slot.id); setOk('Slot archived.'); }
      load();
    } catch (err) { setError(err.message); }
  };

  const runBulk = async () => {
    setSaving(true); setBulkErr(''); setBulkResult(null);
    try {
      const r = await slotsApi.bulk({ ...bulk, startHour: parseInt(bulk.startHour), endHour: parseInt(bulk.endHour), durationMinutes: parseInt(bulk.durationMinutes), intervalMinutes: parseInt(bulk.intervalMinutes) });
      setBulkResult(r); load();
    } catch (err) { setBulkErr(err.message); }
    finally { setSaving(false); }
  };

  const exportCsv = async () => {
    setCsvLoading(true);
    try {
      const res = await scheduleApi.exportCsv(csvDate);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `schedule-${csvDate}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
    finally { setCsvLoading(false); }
  };

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const b = (k) => (e) => setBulk(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="page-body">
      <div className="page-header">
        <div>
          <h1 className="page-title">Slots</h1>
          <p className="page-subtitle">Manage appointment availability</p>
        </div>
        <div className="btn-group">
          {isFD && <button className="btn btn-secondary" onClick={()=>setBulkModal(true)}>⚡ Bulk Generate</button>}
          <button className="btn btn-primary" onClick={openCreate}>+ New Slot</button>
        </div>
      </div>

      {/* CSV export bar (FD only) */}
      {isFD && (
        <div className="card" style={{marginBottom:'1rem', display:'flex', gap:'1rem', alignItems:'flex-end', flexWrap:'wrap'}}>
          <div className="form-group" style={{marginBottom:0}}>
            <label>📄 Export day schedule as CSV</label>
            <input type="date" value={csvDate} onChange={e=>setCsvDate(e.target.value)} style={{width:'auto'}} />
          </div>
          <button className="btn btn-secondary" onClick={exportCsv} disabled={csvLoading}>
            {csvLoading ? 'Exporting…' : '⬇️ Download CSV'}
          </button>
          <div className="form-group" style={{marginBottom:0, marginLeft:'auto'}}>
            <label style={{display:'flex',alignItems:'center',gap:'0.4rem',cursor:'pointer'}}>
              <input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)} style={{width:'auto'}} />
              Show archived slots
            </label>
          </div>
        </div>
      )}

      {error && <div className="error-banner">⚠️ {error}</div>}
      {ok    && <div className="success-banner">✅ {ok}</div>}

      {loading ? <Spinner /> : (
        slots.length === 0
          ? <EmptyState icon="🕐" title="No slots found" text={isFD ? 'Create a slot to get started.' : 'No slots assigned to you.'} action={<button className="btn btn-primary" onClick={openCreate}>+ Create Slot</button>} />
          : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Start Time</th>
                      <th>Provider</th>
                      <th>Duration</th>
                      <th>Status</th>
                      <th>Patient</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map(s => (
                      <tr key={s.id} onClick={e=>{ if(e.target.tagName==='BUTTON') return; if(s.status!=='Available') navigate(`/appointments/${s.id}`); }}>
                        <td>{fmt(s.startTime)}</td>
                        <td>{s.provider?.name ?? '—'}</td>
                        <td>{s.durationMinutes} min</td>
                        <td><StatusBadge status={s.status} /></td>
                        <td>{s.patientName || <span className="text-muted">—</span>}</td>
                        <td onClick={e=>e.stopPropagation()}>
                          <div className="btn-group">
                            {s.status === 'Available' && !s.isArchived && (
                              <button className="btn btn-secondary btn-sm" onClick={()=>openEdit(s)}>Edit</button>
                            )}
                            <button className={`btn btn-sm ${s.isArchived?'btn-success':'btn-ghost'}`} onClick={()=>archiveSlot(s)}>
                              {s.isArchived ? 'Restore' : 'Archive'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination {...pagination} page={page} onPage={setPage} />
            </>
          )
      )}

      {/* Create / Edit slot modal */}
      {slotModal && (
        <Modal title={editSlot ? 'Edit Slot' : 'Create New Slot'} onClose={()=>setSlotModal(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={()=>setSlotModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveSlot} disabled={saving}>{saving?'Saving…':'Save Slot'}</button>
          </>}>
          {formErr && <div className="error-banner">{formErr}</div>}
          <div className="form-group">
            <label>Provider ID {isFD && '*'}</label>
            <input value={form.providerId} onChange={f('providerId')} placeholder={isFD ? 'Provider UUID' : user.id} disabled={!isFD} />
            {!isFD && <p className="text-muted text-sm mt-1">You can only create slots for yourself.</p>}
          </div>
          <div className="form-group">
            <label>Start Date & Time *</label>
            <input type="datetime-local" value={form.startTime} onChange={f('startTime')} />
          </div>
          <div className="form-group">
            <label>Duration (minutes) *</label>
            <input type="number" min="5" max="240" step="5" value={form.durationMinutes} onChange={f('durationMinutes')} />
          </div>
        </Modal>
      )}

      {/* Bulk generation modal */}
      {bulkModal && (
        <Modal title="⚡ Bulk Generate Slots" onClose={()=>{ setBulkModal(false); setBulkResult(null); setBulkErr(''); }}>
          {bulkErr    && <div className="error-banner">{bulkErr}</div>}
          {bulkResult && (
            <div className="success-banner">
              ✅ Created <strong>{bulkResult.summary.created}</strong> slots, skipped <strong>{bulkResult.summary.skipped}</strong> conflicts.
            </div>
          )}
          <div className="form-row">
            <div className="form-group"><label>Provider ID *</label><input value={bulk.providerId} onChange={b('providerId')} placeholder="UUID" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Start Date *</label><input type="date" value={bulk.startDate} onChange={b('startDate')} /></div>
            <div className="form-group"><label>End Date *</label><input type="date" value={bulk.endDate} onChange={b('endDate')} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Start Hour (0–23)</label><input type="number" min="0" max="23" value={bulk.startHour} onChange={b('startHour')} /></div>
            <div className="form-group"><label>End Hour (0–23)</label><input type="number" min="0" max="23" value={bulk.endHour} onChange={b('endHour')} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Duration (min)</label><input type="number" value={bulk.durationMinutes} onChange={b('durationMinutes')} /></div>
            <div className="form-group"><label>Interval (min)</label><input type="number" value={bulk.intervalMinutes} onChange={b('intervalMinutes')} /></div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={()=>setBulkModal(false)}>Close</button>
            <button className="btn btn-primary" onClick={runBulk} disabled={saving}>{saving?'Generating…':'Generate Slots'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
