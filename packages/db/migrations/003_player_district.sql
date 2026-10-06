-- =============================================================================
-- Migration 003 — Player District ID for Atomic Spatial Snapshots
-- Fix: Allows updating pos_x, pos_y, and district_id atomically with ledger_entries
-- =============================================================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS district_id TEXT;
