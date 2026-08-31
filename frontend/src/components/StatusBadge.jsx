export default function StatusBadge({ status }) {
  const label = status || 'Unknown';
  return <span className={`status-badge status-${label}`}>{label}</span>;
}
