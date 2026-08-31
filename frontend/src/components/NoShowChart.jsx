// Pure CSS bar chart for weekly no-show rate
export default function NoShowChart({ weeks = [] }) {
  if (!weeks.length) return null;
  const maxRate = Math.max(...weeks.map(w => w.noShowRate), 5);

  return (
    <div>
      <div className="chart-bars">
        {weeks.map((w, i) => (
          <div key={i} className="chart-bar-wrap" title={`${w.weekStart}: ${w.noShowRate}% (${w.noShows}/${w.total})`}>
            <div
              className="chart-bar"
              style={{ height: `${(w.noShowRate / maxRate) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:'6px', overflowX:'auto', paddingTop:'0.25rem' }}>
        {weeks.map((w, i) => (
          <div key={i} style={{ flex:1, textAlign:'center' }}>
            <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', whiteSpace:'nowrap', transform:'rotate(-25deg)', transformOrigin:'top center', marginTop:'0.5rem' }}>
              {w.weekStart.slice(5)}
            </div>
            <div style={{ fontSize:'0.7rem', fontWeight:'700', color:'var(--primary-hover)', marginTop:'0.2rem' }}>
              {w.noShowRate}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
