-- Identity links are operator-owned; provider profile names/emails never link accounts.
create table auth_identities (
  issuer text not null,
  subject text not null,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issuer, subject)
);
create index auth_identities_user on auth_identities(user_id);

-- Only SHA-256 hashes of cryptographically random browser bearer tokens are persisted.
create table auth_sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index auth_sessions_expiry on auth_sessions(expires_at);
create index auth_sessions_user on auth_sessions(user_id);

-- A separate random HttpOnly cookie binds the single-use state to the initiating browser.
create table auth_login_transactions (
  state_hash text primary key,
  browser_hash text not null,
  code_verifier text not null,
  nonce text not null,
  return_to text not null,
  expires_at timestamptz not null
);
create index auth_login_transactions_expiry on auth_login_transactions(expires_at);
