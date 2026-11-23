CREATE TABLE public.todo_inn_auth_rate_limits (
    bucket_key text PRIMARY KEY,
    request_count integer NOT NULL CHECK (request_count > 0),
    expires_at timestamptz NOT NULL
);
CREATE INDEX todo_inn_auth_rate_limits_expiry_idx ON public.todo_inn_auth_rate_limits (expires_at);
