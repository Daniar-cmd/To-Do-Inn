CREATE TABLE public.boards (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    name character varying(60) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    board_type character varying(16) DEFAULT 'personal'::character varying NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    corporate_account_id bigint,
    lists_order_customized boolean DEFAULT false NOT NULL,
    CONSTRAINT boards_board_type_check CHECK (((board_type)::text = ANY ((ARRAY['personal'::character varying, 'community'::character varying, 'corporate'::character varying])::text[])))
);

ALTER TABLE public.boards ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.boards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.corporate_account_members (
    id bigint NOT NULL,
    corporate_account_id bigint NOT NULL,
    user_id bigint,
    email character varying(254) NOT NULL,
    role character varying(16) NOT NULL,
    invitation_token_hash character(64),
    invitation_expires_at timestamp with time zone,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT corporate_account_members_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'manager'::character varying, 'support'::character varying])::text[])))
);

ALTER TABLE public.corporate_account_members ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.corporate_account_members_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.corporate_accounts (
    id bigint NOT NULL,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    root_username character varying(24),
    root_email character varying(254),
    root_password_hash text,
    organization_type character varying(16),
    organization_name character varying(160),
    secondary_email character varying(254),
    description text DEFAULT ''::text NOT NULL,
    avatar_data bytea,
    avatar_mime character varying(24),
    github_url character varying(255),
    preferred_theme character varying(16) DEFAULT 'system'::character varying NOT NULL,
    personal_data_consent_at timestamp with time zone,
    personal_data_consent_version character varying(32),
    marketing_consent boolean DEFAULT false NOT NULL,
    marketing_consent_at timestamp with time zone,
    telegram_url character varying(255),
    CONSTRAINT corporate_accounts_avatar_pair CHECK ((((avatar_data IS NULL) AND (avatar_mime IS NULL)) OR ((avatar_data IS NOT NULL) AND ((avatar_mime)::text = ANY ((ARRAY['image/jpeg'::character varying, 'image/png'::character varying, 'image/webp'::character varying])::text[]))))),
    CONSTRAINT corporate_accounts_emails_different CHECK (((root_email IS NULL) OR (secondary_email IS NULL) OR (lower((root_email)::text) <> lower((secondary_email)::text)))),
    CONSTRAINT corporate_accounts_github_url_format CHECK (((github_url IS NULL) OR ((github_url)::text ~ '^https://github\.com/[A-Za-z0-9-]{1,39}/?$'::text))),
    CONSTRAINT corporate_accounts_marketing_consent_pair CHECK ((((marketing_consent = false) AND (marketing_consent_at IS NULL)) OR ((marketing_consent = true) AND (marketing_consent_at IS NOT NULL)))),
    CONSTRAINT corporate_accounts_personal_data_consent_pair CHECK ((((personal_data_consent_at IS NULL) AND (personal_data_consent_version IS NULL)) OR ((personal_data_consent_at IS NOT NULL) AND (personal_data_consent_version IS NOT NULL)))),
    CONSTRAINT corporate_accounts_preferred_theme_check CHECK (((preferred_theme)::text = ANY ((ARRAY['light'::character varying, 'dark'::character varying, 'system'::character varying])::text[]))),
    CONSTRAINT corporate_accounts_telegram_url_format CHECK (((telegram_url IS NULL) OR ((telegram_url)::text ~* '^https://t\.me/[A-Za-z0-9_]{5,32}/?$'::text)))
);

ALTER TABLE public.corporate_accounts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.corporate_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.migrations (
    id integer NOT NULL,
    migration character varying(255) NOT NULL,
    batch integer NOT NULL
);

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;

CREATE TABLE public.notes (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    board_id bigint NOT NULL,
    flag_id bigint,
    title character varying(80) NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    annotation text DEFAULT ''::text NOT NULL,
    is_important boolean DEFAULT false NOT NULL,
    theme character varying(16) DEFAULT 'blue'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    image_data bytea,
    image_mime character varying(32),
    image_offset integer,
    CONSTRAINT notes_annotation_length CHECK ((char_length(annotation) <= 200)),
    CONSTRAINT notes_body_length CHECK ((char_length(body) <= 1200)),
    CONSTRAINT notes_image_metadata_check CHECK ((((image_data IS NULL) AND (image_mime IS NULL) AND (image_offset IS NULL)) OR ((image_data IS NOT NULL) AND (image_mime IS NOT NULL) AND ((image_mime)::text = ANY ((ARRAY['image/png'::character varying, 'image/jpeg'::character varying, 'image/webp'::character varying, 'image/gif'::character varying, 'image/heic'::character varying, 'image/avif'::character varying])::text[])) AND (image_offset IS NOT NULL) AND (image_offset >= 0)))),
    CONSTRAINT notes_theme_check CHECK (((theme)::text = ANY ((ARRAY['blue'::character varying, 'violet'::character varying, 'green'::character varying, 'amber'::character varying, 'rose'::character varying, 'sky'::character varying])::text[]))),
    CONSTRAINT notes_title_not_empty CHECK ((length(TRIM(BOTH FROM title)) > 0))
);

ALTER TABLE public.notes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    user_id bigint,
    corporate_account_id bigint,
    sender character varying(80) NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    read_at timestamp with time zone,
    CONSTRAINT notifications_recipient_check CHECK ((((user_id IS NOT NULL) AND (corporate_account_id IS NULL)) OR ((user_id IS NULL) AND (corporate_account_id IS NOT NULL))))
);

ALTER TABLE public.notifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.task_lists (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    board_id bigint NOT NULL,
    flag_id bigint,
    name character varying(80) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    is_important boolean DEFAULT false NOT NULL,
    theme character varying(16) DEFAULT 'blue'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    sort_order bigint DEFAULT 0 NOT NULL,
    due_date date,
    CONSTRAINT task_lists_theme_check CHECK (((theme)::text = ANY ((ARRAY['blue'::character varying, 'violet'::character varying, 'green'::character varying, 'amber'::character varying, 'rose'::character varying, 'sky'::character varying])::text[])))
);

ALTER TABLE public.task_lists ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.task_lists_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.tasks (
    id bigint NOT NULL,
    list_id bigint NOT NULL,
    user_id bigint NOT NULL,
    title character varying(240) NOT NULL,
    sort_order bigint DEFAULT 0 NOT NULL,
    is_completed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    board_id bigint NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    is_important boolean DEFAULT false NOT NULL,
    flag_id bigint,
    due_date date,
    location character varying(160),
    scheduled_time time without time zone,
    is_urgent boolean DEFAULT false NOT NULL,
    deadline date,
    urgency smallint DEFAULT 0 NOT NULL,
    repeat_interval character varying(8),
    repeat_series_id uuid,
    repeat_anchor_date date,
    repeat_sequence integer DEFAULT 0 NOT NULL,
    CONSTRAINT tasks_repeat_interval_check CHECK (((repeat_interval IS NULL) OR ((repeat_interval)::text = ANY ((ARRAY['daily'::character varying, 'weekly'::character varying, 'monthly'::character varying, 'yearly'::character varying])::text[])))),
    CONSTRAINT tasks_repeat_sequence_check CHECK ((repeat_sequence >= 0)),
    CONSTRAINT tasks_repeat_series_check CHECK (((repeat_series_id IS NULL) OR (repeat_anchor_date IS NOT NULL))),
    CONSTRAINT tasks_title_not_empty CHECK ((length(TRIM(BOTH FROM title)) > 0)),
    CONSTRAINT tasks_urgency_level_check CHECK (((urgency >= 0) AND (urgency <= 4)))
);

ALTER TABLE public.tasks ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.user_flags (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    board_id bigint NOT NULL,
    name character varying(40) NOT NULL,
    color character varying(16) DEFAULT 'blue'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT user_flags_color_check CHECK (((color)::text = ANY ((ARRAY['blue'::character varying, 'violet'::character varying, 'green'::character varying, 'amber'::character varying, 'rose'::character varying])::text[])))
);

ALTER TABLE public.user_flags ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_flags_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.users (
    id bigint NOT NULL,
    username character varying(24) NOT NULL,
    email character varying(254),
    secondary_email character varying(254),
    password_hash text NOT NULL,
    username_changed_at timestamp with time zone,
    about text DEFAULT ''::text NOT NULL,
    avatar_data bytea,
    avatar_mime character varying(24),
    account_type character varying(16) DEFAULT 'individual'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    first_name character varying(60) DEFAULT ''::character varying NOT NULL,
    last_name character varying(60) DEFAULT ''::character varying NOT NULL,
    organization_type character varying(16),
    organization_name character varying(160),
    middle_name character varying(60),
    github_url character varying(255),
    preferred_theme character varying(16) DEFAULT 'system'::character varying NOT NULL,
    personal_data_consent_at timestamp with time zone,
    personal_data_consent_version character varying(32),
    marketing_consent boolean DEFAULT false NOT NULL,
    marketing_consent_at timestamp with time zone,
    telegram_url character varying(255),
    registration_version smallint DEFAULT 2 NOT NULL,
    password_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT users_account_type_check CHECK (((account_type)::text = ANY ((ARRAY['individual'::character varying, 'team'::character varying, 'corporate'::character varying])::text[]))),
    CONSTRAINT users_avatar_pair CHECK ((((avatar_data IS NULL) AND (avatar_mime IS NULL)) OR ((avatar_data IS NOT NULL) AND ((avatar_mime)::text = ANY ((ARRAY['image/jpeg'::character varying, 'image/png'::character varying, 'image/webp'::character varying])::text[]))))),
    CONSTRAINT users_emails_different CHECK (((email IS NULL) OR (secondary_email IS NULL) OR ((email)::text <> (secondary_email)::text))),
    CONSTRAINT users_github_url_format CHECK (((github_url IS NULL) OR ((github_url)::text ~ '^https://github\.com/[A-Za-z0-9-]{1,39}/?$'::text))),
    CONSTRAINT users_marketing_consent_pair CHECK ((((marketing_consent = false) AND (marketing_consent_at IS NULL)) OR ((marketing_consent = true) AND (marketing_consent_at IS NOT NULL)))),
    CONSTRAINT users_organization_pair_check CHECK ((((organization_type IS NULL) AND (organization_name IS NULL)) OR ((organization_type IS NOT NULL) AND (organization_name IS NOT NULL)))),
    CONSTRAINT users_organization_type_check CHECK (((organization_type IS NULL) OR ((organization_type)::text = ANY ((ARRAY['ИП'::character varying, 'ООО'::character varying, 'ПАО'::character varying, 'НПАО'::character varying, 'НКО'::character varying, 'ГУП/МУП'::character varying, 'ГУП'::character varying, 'МУП'::character varying, 'Другое'::character varying])::text[])))),
    CONSTRAINT users_password_version_check CHECK ((password_version >= 0)),
    CONSTRAINT users_personal_data_consent_pair CHECK ((((personal_data_consent_at IS NULL) AND (personal_data_consent_version IS NULL)) OR ((personal_data_consent_at IS NOT NULL) AND (personal_data_consent_version IS NOT NULL)))),
    CONSTRAINT users_preferred_theme_check CHECK (((preferred_theme)::text = ANY ((ARRAY['light'::character varying, 'dark'::character varying, 'system'::character varying])::text[]))),
    CONSTRAINT users_registration_version_check CHECK ((registration_version = ANY (ARRAY[1, 2]))),
    CONSTRAINT users_telegram_url_format CHECK (((telegram_url IS NULL) OR ((telegram_url)::text ~* '^https://t\.me/[A-Za-z0-9_]{5,32}/?$'::text))),
    CONSTRAINT users_username_format CHECK ((((username)::text ~ '^[A-Za-z][A-Za-z0-9_@-]{2,23}$'::text) OR ((username)::text ~ '^@[A-Za-z][A-Za-z0-9_-]{2,22}$'::text)))
);

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.migrations ALTER COLUMN id SET DEFAULT nextval('public.migrations_id_seq'::regclass);

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_user_id_name_key UNIQUE (user_id, name);

ALTER TABLE ONLY public.corporate_account_members
    ADD CONSTRAINT corporate_account_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.corporate_accounts
    ADD CONSTRAINT corporate_accounts_owner_user_id_key UNIQUE (created_by_user_id);

ALTER TABLE ONLY public.corporate_accounts
    ADD CONSTRAINT corporate_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_id_user_board_key UNIQUE (id, user_id, board_id);

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_board_id_name_key UNIQUE (board_id, name);

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_id_user_board_key UNIQUE (id, user_id, board_id);

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_flags
    ADD CONSTRAINT user_flags_board_user_name_key UNIQUE (board_id, user_id, name);

ALTER TABLE ONLY public.user_flags
    ADD CONSTRAINT user_flags_id_user_board_key UNIQUE (id, user_id, board_id);

ALTER TABLE ONLY public.user_flags
    ADD CONSTRAINT user_flags_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE ONLY public.user_flags
    ADD CONSTRAINT user_flags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);

CREATE INDEX boards_corporate_account_idx ON public.boards USING btree (corporate_account_id) WHERE (corporate_account_id IS NOT NULL);

CREATE UNIQUE INDEX boards_one_default_per_user ON public.boards USING btree (user_id) WHERE is_default;

CREATE UNIQUE INDEX corporate_account_members_email_idx ON public.corporate_account_members USING btree (corporate_account_id, lower((email)::text));

CREATE UNIQUE INDEX corporate_account_members_invitation_token_idx ON public.corporate_account_members USING btree (invitation_token_hash) WHERE (invitation_token_hash IS NOT NULL);

CREATE UNIQUE INDEX corporate_account_members_owner_idx ON public.corporate_account_members USING btree (corporate_account_id) WHERE ((role)::text = 'owner'::text);

CREATE UNIQUE INDEX corporate_account_members_user_idx ON public.corporate_account_members USING btree (corporate_account_id, user_id) WHERE (user_id IS NOT NULL);

CREATE UNIQUE INDEX corporate_accounts_root_email_idx ON public.corporate_accounts USING btree (lower((root_email)::text)) WHERE (root_email IS NOT NULL);

CREATE UNIQUE INDEX corporate_accounts_root_username_idx ON public.corporate_accounts USING btree (lower((root_username)::text)) WHERE (root_username IS NOT NULL);

CREATE UNIQUE INDEX corporate_accounts_secondary_email_unique ON public.corporate_accounts USING btree (lower((secondary_email)::text)) WHERE (secondary_email IS NOT NULL);

CREATE INDEX notes_board_created_idx ON public.notes USING btree (board_id, created_at DESC, id DESC);

CREATE INDEX notes_board_order_idx ON public.notes USING btree (board_id, is_pinned DESC, sort_order, id);

CREATE INDEX notes_flag_idx ON public.notes USING btree (flag_id) WHERE (flag_id IS NOT NULL);

CREATE INDEX notifications_corporate_created_idx ON public.notifications USING btree (corporate_account_id, created_at DESC) WHERE (corporate_account_id IS NOT NULL);

CREATE INDEX notifications_user_created_idx ON public.notifications USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);

CREATE INDEX task_lists_board_order_idx ON public.task_lists USING btree (board_id, is_pinned DESC, sort_order, id);

CREATE INDEX tasks_list_order_idx ON public.tasks USING btree (list_id, sort_order, id);

CREATE INDEX tasks_repeat_pending_idx ON public.tasks USING btree (repeat_series_id, repeat_sequence DESC) WHERE (repeat_interval IS NOT NULL);

CREATE UNIQUE INDEX tasks_repeat_series_sequence_unique ON public.tasks USING btree (repeat_series_id, repeat_sequence);

CREATE UNIQUE INDEX users_secondary_email_unique ON public.users USING btree (secondary_email) WHERE (secondary_email IS NOT NULL);

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_corporate_account_id_fkey FOREIGN KEY (corporate_account_id) REFERENCES public.corporate_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.corporate_account_members
    ADD CONSTRAINT corporate_account_members_corporate_account_id_fkey FOREIGN KEY (corporate_account_id) REFERENCES public.corporate_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.corporate_account_members
    ADD CONSTRAINT corporate_account_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.corporate_accounts
    ADD CONSTRAINT corporate_accounts_owner_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_board_id_user_id_fkey FOREIGN KEY (board_id, user_id) REFERENCES public.boards(id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_flag_board_fkey FOREIGN KEY (flag_id, user_id, board_id) REFERENCES public.user_flags(id, user_id, board_id) ON DELETE SET NULL (flag_id);

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_corporate_account_id_fkey FOREIGN KEY (corporate_account_id) REFERENCES public.corporate_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_board_id_user_id_fkey FOREIGN KEY (board_id, user_id) REFERENCES public.boards(id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_flag_board_fkey FOREIGN KEY (flag_id, user_id, board_id) REFERENCES public.user_flags(id, user_id, board_id) ON DELETE SET NULL (flag_id);

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_flag_user_board_fkey FOREIGN KEY (flag_id, user_id, board_id) REFERENCES public.user_flags(id, user_id, board_id) ON DELETE SET NULL (flag_id);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.task_lists(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_list_user_board_fkey FOREIGN KEY (list_id, user_id, board_id) REFERENCES public.task_lists(id, user_id, board_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_flags
    ADD CONSTRAINT user_flags_board_id_user_id_fkey FOREIGN KEY (board_id, user_id) REFERENCES public.boards(id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_flags
    ADD CONSTRAINT user_flags_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
