-- ╔══════════════════════════════════════════════════════════╗
-- ║  Migration 009 — Match lobby fixes                      ║
-- ║  1. Expire rooms after 1 hour (was 30 min)              ║
-- ║  2. UNIQUE on at_packages(at_amount) + deduplicate      ║
-- ╚══════════════════════════════════════════════════════════╝

-- ── 1. Change match expiry from 30 min → 1 hour ───────────────────────────────
CREATE OR REPLACE FUNCTION set_match_expires_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.expires_at := NEW.created_at + INTERVAL '1 hour';
    RETURN NEW;
END;
$$;

-- ── 2. Deduplicate at_packages — keep lowest id per at_amount ─────────────────
DELETE FROM at_packages a
WHERE a.id NOT IN (
    SELECT MIN(id) FROM at_packages GROUP BY at_amount
);

-- ── 3. Add UNIQUE constraint on at_packages(at_amount) ────────────────────────
ALTER TABLE at_packages
    ADD CONSTRAINT uq_at_packages_amount UNIQUE (at_amount);
