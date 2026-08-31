export default function Pagination({ page, totalPages, total, pageSize, onPage }) {
  if (totalPages <= 1) return null;

  const pages = [];
  const start = Math.max(1, page - 2);
  const end   = Math.min(totalPages, page + 2);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="pagination">
      <button className="page-btn" onClick={() => onPage(page - 1)} disabled={page <= 1}>‹</button>
      {start > 1 && <><button className="page-btn" onClick={() => onPage(1)}>1</button><span className="text-muted">…</span></>}
      {pages.map(p => (
        <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => onPage(p)}>{p}</button>
      ))}
      {end < totalPages && <><span className="text-muted">…</span><button className="page-btn" onClick={() => onPage(totalPages)}>{totalPages}</button></>}
      <button className="page-btn" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>›</button>
      <span className="pagination-info">{total} total</span>
    </div>
  );
}
