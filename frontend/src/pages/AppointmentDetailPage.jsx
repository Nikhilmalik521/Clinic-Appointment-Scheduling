import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { appointmentsApi } from '../api/appointments';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';

const fmt = (iso) => iso ? new Date(iso).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' }) : '—';

// ── Transition buttons by current status ───────────────────────────────
const TRANSITIONS = {
  Requested: [
    { label:'✅ Confirm',     key:'confirm',  cls:'btn-success' },
    { label:'❌ Cancel',      key:'cancel',   cls:'btn-danger',  needsReason:true },
  ],
  Confirmed: [
    { label:'🛋️ Check In',   key:'checkin',  cls:'btn-primary' },
    { label:'❌ Cancel',      key:'cancel',   cls:'btn-danger',  needsReason:true },
    { label:'🚫 No Show',    key:'noshow',   cls:'btn-danger',  fdOnly:false },
  ],
  CheckedIn: [
    { label:'✔️ Complete',   key:'complete', cls:'btn-success' },
  ],
};

// ── Timeline event renderer ────────────────────────────────────────────
function TimelineEvent({ event }) {
  const d = event.eventData || {};
  let detail = '';
  if (event.eventType === 'status_change')    detail = `${d.from} → ${d.to}`;
  if (event.eventType === 'cancellation')     detail = `Reason: ${d.reason}`;
  if (event.eventType === 'care_team_change') detail = `${d.action === 'added' ? '+ Added' : '- Removed'}: ${d.providerName}`;
  if (event.eventType === 'note_added')       detail = `Note by ${event.performedBy?.name}`;

  return (
    <div className="timeline-item">
      <div className={`timeline-dot ${event.eventType}`} />
      <div className="timeline-content">
        <div className="timeline-header">
          <span className="timeline-type">{event.eventType.replace(/_/g,' ')}</span>
          <span className="timeline-by">by {event.performedBy?.name}</span>
          <span className="timeline-date">{fmt(event.createdAt)}</span>
        </div>
        {detail && <div className="timeline-detail">{detail}</div>}
      </div>
    </div>
  );
}

export default function AppointmentDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate  = useNavigate();
  const isFD = user?.role === 'front-desk';

  const [appt,    setAppt]    = useState(null);
  const [history, setHistory] = useState([]);
  const [notes,   setNotes]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [actionErr, setActionErr] = useState('');
  const [actionOk,  setActionOk]  = useState('');

  // Modals
  const [cancelModal,  setCancelModal]  = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [noteModal,    setNoteModal]    = useState(false);
  const [noteText,     setNoteText]     = useState('');
  const [editNoteId,   setEditNoteId]   = useState(null);
  const [careModal,    setCareModal]    = useState(false);
  const [careEmail,    setCareEmail]    = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [a, h, n] = await Promise.all([
        appointmentsApi.get(id),
        appointmentsApi.history(id),
        appointmentsApi.getNotes(id),
      ]);
      setAppt(a.slot ?? a);
      setHistory(h.history ?? []);
      setNotes(n.notes ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const act = async (key, data = {}) => {
    setActionErr(''); setActionOk(''); setSaving(true);
    try {
      const map = {
        confirm:  () => appointmentsApi.confirm(id),
        checkin:  () => appointmentsApi.checkin(id),
        complete: () => appointmentsApi.complete(id),
        noshow:   () => appointmentsApi.noshow(id),
        cancel:   () => appointmentsApi.cancel(id, data.reason),
      };
      await map[key]();
      setActionOk('Status updated successfully.');
      load();
    } catch (err) {
      setActionErr(err.message);
    } finally {
      setSaving(false);
    }
  };

  const doCancel = async () => {
    if (!cancelReason.trim()) { setActionErr('Cancellation reason is required'); return; }
    await act('cancel', { reason: cancelReason });
    setCancelModal(false); setCancelReason('');
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    setSaving(true); setActionErr('');
    try {
      if (editNoteId) await appointmentsApi.editNote(id, editNoteId, noteText.trim());
      else            await appointmentsApi.addNote(id, noteText.trim());
      setNoteModal(false); setNoteText(''); setEditNoteId(null);
      load();
    } catch (err) { setActionErr(err.message); }
    finally { setSaving(false); }
  };

  const removeCare = async (providerId) => {
    if (!confirm('Remove this provider from the care team?')) return;
    try { await appointmentsApi.removeCareTeam(id, providerId); load(); }
    catch (err) { setActionErr(err.message); }
  };

  if (loading) return <Spinner />;
  if (error)   return <div className="page-body"><div className="error-banner">⚠️ {error}</div></div>;
  if (!appt)   return null;

  const transitions = TRANSITIONS[appt.status] || [];
  const canAddNote  = appt.status !== 'Available' && !isFD;

  return (
    <div className="page-body">
      <div className="page-header">
        <div>
          <button className="btn btn-ghost btn-sm" style={{marginBottom:'0.5rem'}} onClick={()=>navigate('/appointments')}>
            ← Back
          </button>
          <h1 className="page-title">{appt.patientName || 'Unnamed Patient'}</h1>
          <div style={{marginTop:'0.4rem', display:'flex', gap:'0.5rem', alignItems:'center'}}>
            <StatusBadge status={appt.status} />
            <span className="text-muted text-sm">{fmt(appt.startTime)} · {appt.durationMinutes} min</span>
          </div>
        </div>
      </div>

      {actionErr && <div className="error-banner">⚠️ {actionErr}</div>}
      {actionOk  && <div className="success-banner">✅ {actionOk}</div>}

      <div className="detail-grid">
        {/* ── Left column ─────────────────────────────────────── */}
        <div style={{display:'flex',flexDirection:'column',gap:'1.25rem'}}>

          {/* Basic info */}
          <div className="card">
            <div className="section-title">📋 Appointment Info</div>
            <div className="info-rows">
              <div className="info-row"><span className="info-label">Patient</span><span className="info-value">{appt.patientName || '—'}</span></div>
              <div className="info-row"><span className="info-label">Provider</span><span className="info-value">{appt.provider?.name}</span></div>
              <div className="info-row"><span className="info-label">Start Time</span><span className="info-value">{fmt(appt.startTime)}</span></div>
              <div className="info-row"><span className="info-label">Duration</span><span className="info-value">{appt.durationMinutes} minutes</span></div>
              <div className="info-row"><span className="info-label">Status</span><span className="info-value"><StatusBadge status={appt.status} /></span></div>
              {appt.cancellationReason && <div className="info-row"><span className="info-label">Cancel Reason</span><span className="info-value" style={{color:'var(--error)'}}>{appt.cancellationReason}</span></div>}
            </div>

            {/* Action buttons */}
            {transitions.length > 0 && (isFD || appt.status === 'CheckedIn') && (
              <div className="transition-btns">
                {transitions.map(t => {
                  if (t.fdOnly === false && !isFD) return null;
                  if (t.needsReason) return (
                    <button key={t.key} className={`btn ${t.cls}`} disabled={saving} onClick={()=>setCancelModal(true)}>
                      {t.label}
                    </button>
                  );
                  return (
                    <button key={t.key} className={`btn ${t.cls}`} disabled={saving} onClick={()=>act(t.key)}>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Care team */}
          <div className="card">
            <div className="section-title" style={{justifyContent:'space-between'}}>
              <span>👥 Care Team</span>
              {isFD && <button className="btn btn-ghost btn-sm" onClick={()=>setCareModal(true)}>+ Add Provider</button>}
            </div>
            {(appt.careTeam ?? []).length === 0
              ? <p className="text-muted text-sm">No supporting providers added.</p>
              : (appt.careTeam ?? []).map(ct => (
                <div key={ct.providerId} style={{display:'flex',alignItems:'center',gap:'0.5rem',padding:'0.4rem 0',borderBottom:'1px solid var(--border)'}}>
                  <span style={{flex:1,fontSize:'0.87rem'}}>{ct.provider?.name}</span>
                  {isFD && <button className="btn btn-danger btn-sm" onClick={()=>removeCare(ct.providerId)}>Remove</button>}
                </div>
              ))
            }
          </div>

          {/* Visit notes */}
          <div className="card">
            <div className="section-title" style={{justifyContent:'space-between'}}>
              <span>📝 Visit Notes</span>
              {canAddNote && <button className="btn btn-ghost btn-sm" onClick={()=>{setNoteModal(true);setEditNoteId(null);setNoteText('');}}>+ Add Note</button>}
            </div>
            {notes.length === 0
              ? <p className="text-muted text-sm">No visit notes yet.</p>
              : notes.map(n => (
                <div key={n.id} className="note-card">
                  <div className="note-header">
                    <span className="note-author">{n.provider?.name ?? 'Provider'}</span>
                    <span className="note-date">{fmt(n.createdAt)}</span>
                    {!isFD && n.providerId === user?.id && (
                      <button className="btn btn-ghost btn-sm" onClick={()=>{setEditNoteId(n.id);setNoteText(n.noteText);setNoteModal(true);}}>Edit</button>
                    )}
                  </div>
                  <div className="note-text">{n.noteText}</div>
                </div>
              ))
            }
          </div>
        </div>

        {/* ── Right column — History ────────────────────────── */}
        <div className="card" style={{alignSelf:'start'}}>
          <div className="section-title">📜 History (Append-Only)</div>
          {history.length === 0
            ? <p className="text-muted text-sm">No history events yet.</p>
            : (
              <div className="timeline">
                {history.map(e => <TimelineEvent key={e.id} event={e} />)}
              </div>
            )
          }
        </div>
      </div>

      {/* Cancel modal */}
      {cancelModal && (
        <Modal title="Cancel Appointment" onClose={()=>setCancelModal(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={()=>setCancelModal(false)}>Back</button>
            <button className="btn btn-danger" onClick={doCancel} disabled={saving}>{saving?'Cancelling…':'Confirm Cancel'}</button>
          </>}>
          <div className="form-group">
            <label>Cancellation Reason *</label>
            <textarea rows={3} value={cancelReason} onChange={e=>setCancelReason(e.target.value)} placeholder="Required reason…" />
          </div>
        </Modal>
      )}

      {/* Note modal */}
      {noteModal && (
        <Modal title={editNoteId ? 'Edit Note' : 'Add Visit Note'} onClose={()=>setNoteModal(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={()=>setNoteModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveNote} disabled={saving}>{saving?'Saving…':'Save Note'}</button>
          </>}>
          <div className="form-group">
            <label>Note Text *</label>
            <textarea rows={5} autoFocus value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Provider observations…" />
          </div>
        </Modal>
      )}

      {/* Care team add modal */}
      {careModal && (
        <Modal title="Add Supporting Provider" onClose={()=>setCareModal(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={()=>setCareModal(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={async()=>{
              setSaving(true);setActionErr('');
              try{await appointmentsApi.addCareTeam(id, careEmail);setCareModal(false);setCareEmail('');load();}
              catch(err){setActionErr(err.message);}finally{setSaving(false);}
            }}>{saving?'Adding…':'Add'}</button>
          </>}>
          <div className="form-group">
            <label>Provider ID or email</label>
            <input autoFocus value={careEmail} onChange={e=>setCareEmail(e.target.value)} placeholder="Provider UUID" />
            <p className="text-muted text-sm mt-1">Enter the provider's user ID from the Slots page.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
