-- 0002: registration consent
alter table customers add column if not exists privacy_consent_at timestamptz;
