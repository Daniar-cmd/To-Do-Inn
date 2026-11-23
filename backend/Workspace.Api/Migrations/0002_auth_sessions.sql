CREATE TABLE public.todo_inn_auth_sessions (
    cache_key text PRIMARY KEY,
    data bytea NOT NULL,
    expires_at timestamptz NOT NULL,
    absolute_expires_at timestamptz,
    sliding_seconds double precision,
    CHECK (sliding_seconds IS NULL OR sliding_seconds > 0)
);
CREATE INDEX todo_inn_auth_sessions_expiry_idx ON public.todo_inn_auth_sessions (expires_at);
