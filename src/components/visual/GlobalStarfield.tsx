/**
 * Subtle distant “tech night sky” sparkles — fixed behind UI, pointer-events none.
 * Paired with styles in index.css (.arena-global-starfield).
 */
export function GlobalStarfield() {
  return (
    <div className="arena-global-starfield" aria-hidden>
      <div className="arena-star-layer arena-star-layer--a" />
      <div className="arena-star-layer arena-star-layer--b" />
      <div className="arena-star-layer arena-star-layer--c" />
    </div>
  );
}
