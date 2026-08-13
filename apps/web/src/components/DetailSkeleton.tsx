// Skeleton placeholder for detail pages (mirrors the .skeleton-line shimmer
// already used in list-page table rows), shown while the first fetch is in flight.
export default function DetailSkeleton() {
  return (
    <div className="stack">
      <div className="page-header">
        <span className="skeleton-line" style={{ width: 220, height: 24 }} />
      </div>
      {[0, 1, 2].map((card) => (
        <div className="card" key={card}>
          <div className="grid cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <span className="skeleton-line" style={{ width: '60%', marginBottom: 6 }} />
                <span className="skeleton-line" style={{ width: '85%' }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
