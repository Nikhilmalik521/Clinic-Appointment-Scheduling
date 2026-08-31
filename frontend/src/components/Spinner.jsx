export default function Spinner({ text = 'Loading…' }) {
  return (
    <div className="spinner-wrap" role="status" aria-label={text}>
      <div className="spinner" />
    </div>
  );
}
