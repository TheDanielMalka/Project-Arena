/**
 * Sparse twinkling sparkles — rendered inside ArenaAmbientBackground (above blurs/grid).
 */
export function ArenaStarfield() {
  return (
    <div className="arena-ambient-starfield" aria-hidden>
      <div className="arena-star-layer arena-star-layer--a" />
      <div className="arena-star-layer arena-star-layer--b" />
      <div className="arena-star-layer arena-star-layer--c" />
    </div>
  );
}
