-- ════════════════════════════════════════════════════════════════════════════
-- KAASEB — canonical database schema
-- ════════════════════════════════════════════════════════════════════════════
-- Run ONCE in Supabase SQL Editor. Drops and rebuilds the public schema.
-- After running, the user `elzubair.mail@gmail.com` is auto-promoted to
-- super_admin if their auth.users row exists.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. Reset + extensions ───────────────────────────────────────────────────
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ── 1. Profiles + custom roles ──────────────────────────────────────────────
CREATE TABLE public.profiles (
  id                     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                  TEXT NOT NULL,
  full_name              TEXT,
  avatar_url             TEXT,
  role                   TEXT NOT NULL DEFAULT 'employee'
                              CHECK (role IN ('super_admin','project_manager','employee')),
  bio                    TEXT,
  title                  TEXT,
  language               TEXT NOT NULL DEFAULT 'ar',
  total_points           INTEGER NOT NULL DEFAULT 0,
  lock_password_hash     TEXT,
  lock_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  off_days               JSONB NOT NULL DEFAULT '[]',
  custom_role_id         UUID,
  is_department_manager  BOOLEAN NOT NULL DEFAULT FALSE,
  scope                  TEXT NOT NULL DEFAULT 'both',
  must_change_password   BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '[]',
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_custom_role_fk
  FOREIGN KEY (custom_role_id) REFERENCES public.custom_roles(id) ON DELETE SET NULL;

CREATE TABLE public.user_badges (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, badge_key)
);


-- ── 2. App config (singleton) ───────────────────────────────────────────────
CREATE TABLE public.app_config (
  id                       SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  employees_can_create_dm  BOOLEAN NOT NULL DEFAULT FALSE,
  post_reward_points       INT NOT NULL DEFAULT 0,
  post_reward_daily_limit  INT NOT NULL DEFAULT 0,
  story_reward_points      INT NOT NULL DEFAULT 0,
  story_reward_daily_limit INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by               UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
INSERT INTO public.app_config (id) VALUES (1);


-- ── 3. Departments + members + jobs ─────────────────────────────────────────
CREATE TABLE public.departments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  vision      TEXT,
  mission     TEXT,
  color       TEXT,
  icon        TEXT,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.department_members (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_manager    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (department_id, user_id)
);

CREATE TABLE public.job_descriptions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id    UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  role_name        TEXT NOT NULL,
  responsibilities JSONB NOT NULL DEFAULT '[]',
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.department_member_job_descriptions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id          UUID NOT NULL REFERENCES public.department_members(id) ON DELETE CASCADE,
  job_description_id UUID NOT NULL REFERENCES public.job_descriptions(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, job_description_id)
);

CREATE TABLE public.important_links (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  description   TEXT,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.department_files (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  file_size     BIGINT,
  file_type     TEXT NOT NULL,
  uploaded_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.department_checklist (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.department_payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id   UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  amount          DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_type    TEXT NOT NULL DEFAULT 'monthly'
                       CHECK (payment_type IN ('monthly','annual','one_time')),
  department_name TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','paused','due')),
  last_paid_at    DATE,
  note            TEXT,
  card_holder     TEXT,
  card_last4      TEXT,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.evaluation_criteria (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('excellent','poor')),
  criteria      TEXT NOT NULL,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.achievements (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id    UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  achievement_date DATE,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.department_recurring_tasks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id     UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  points            INTEGER NOT NULL DEFAULT 0,
  task_type         TEXT NOT NULL DEFAULT 'recurring'
                          CHECK (task_type IN ('recurring','one_time')),
  assigned_position TEXT,
  assigned_user_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  position          INTEGER NOT NULL DEFAULT 0,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.department_recurring_completions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id        UUID NOT NULL REFERENCES public.department_recurring_tasks(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  completed_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, completed_date)
);

CREATE TABLE public.department_doodles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  image_url     TEXT,
  categories    TEXT[] NOT NULL DEFAULT '{}',
  visibility    TEXT NOT NULL DEFAULT 'everyone'
                     CHECK (visibility IN ('everyone','specific')),
  visible_to    UUID[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 4. Projects + tasks ─────────────────────────────────────────────────────
CREATE TABLE public.projects (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  description   TEXT,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','completed','archived')),
  columns       JSONB DEFAULT '[
    {"id":"backlog","name":"Backlog"},
    {"id":"todo","name":"To Do"},
    {"id":"in_progress","name":"In Progress"},
    {"id":"testing","name":"Testing"},
    {"id":"done","name":"Done"}
  ]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.tasks (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id       UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  assigned_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'backlog',
  points           INTEGER NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL DEFAULT 0,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  points_awarded   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.project_achievements (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id       UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  achievement_date DATE,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.project_evaluation_criteria (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('excellent','poor')),
  criteria   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.project_checklist (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  completed   BOOLEAN NOT NULL DEFAULT FALSE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 5. Goals + roadmap ──────────────────────────────────────────────────────
CREATE TABLE public.goals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title         TEXT NOT NULL,
  description   TEXT,
  subtitle      TEXT,
  image_url     TEXT,
  color         TEXT,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  is_global     BOOLEAN NOT NULL DEFAULT FALSE,
  owner_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  paused        BOOLEAN NOT NULL DEFAULT FALSE,
  pause_reason  TEXT,
  paused_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  paused_at     TIMESTAMPTZ,
  start_date    DATE,
  end_date      DATE,
  reward_points INTEGER NOT NULL DEFAULT 0,
  order_index   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.goal_steps (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id    UUID NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  completed  BOOLEAN NOT NULL DEFAULT FALSE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.goal_step_tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id               UUID NOT NULL REFERENCES public.goal_steps(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  completed             BOOLEAN NOT NULL DEFAULT FALSE,
  position              INTEGER NOT NULL DEFAULT 0,
  assigned_user_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_to_everyone  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.goal_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id    UUID NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (goal_id, user_id)
);


-- ── 6. Daily tasks + pending points ─────────────────────────────────────────
CREATE TABLE public.daily_tasks (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title            TEXT NOT NULL,
  description      TEXT,
  assigned_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_id    UUID REFERENCES public.departments(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  completed        BOOLEAN NOT NULL DEFAULT FALSE,
  task_type        TEXT NOT NULL DEFAULT 'one_time'
                        CHECK (task_type IN ('recurring','one_time')),
  points           INTEGER NOT NULL DEFAULT 0,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.pending_points (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_name   TEXT,
  user_email  TEXT,
  action_type TEXT NOT NULL DEFAULT 'task_completed',
  object_type TEXT NOT NULL DEFAULT 'task',
  object_name TEXT,
  object_id   UUID,
  points      INTEGER NOT NULL DEFAULT 0,
  is_off_day  BOOLEAN NOT NULL DEFAULT FALSE,
  status      TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected')),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 7. Community: stories, posts, polls, chat ───────────────────────────────
CREATE TABLE public.stories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('text','image','video')),
  text_content TEXT,
  bg_color     TEXT,
  media_url    TEXT,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.story_views (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id  UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (story_id, user_id)
);

CREATE TABLE public.posts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content    TEXT DEFAULT '',
  media_url  TEXT,
  media_type TEXT CHECK (media_type IN ('image','video')),
  type       TEXT NOT NULL DEFAULT 'normal' CHECK (type IN ('normal','poll')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.post_likes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, user_id)
);

CREATE TABLE public.post_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content    TEXT DEFAULT '',
  media_url  TEXT,
  media_type TEXT CHECK (media_type IN ('image','video','file')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.post_poll_options (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.post_poll_votes (
  post_id    UUID NOT NULL REFERENCES public.posts(id)             ON DELETE CASCADE,
  option_id  UUID NOT NULL REFERENCES public.post_poll_options(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id)          ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE public.chat_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,
  type        TEXT NOT NULL CHECK (type IN ('dm','group')),
  image_url   TEXT,
  description TEXT,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.chat_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.profiles(id)          ON DELETE CASCADE,
  is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE public.chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES public.profiles(id)          ON DELETE CASCADE,
  content         TEXT,
  media_url       TEXT,
  media_type      TEXT CHECK (media_type IN ('image','video','file')),
  reply_to_id     UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 8. AI chat ──────────────────────────────────────────────────────────────
CREATE TABLE public.ai_conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 9. Knowledge center (docs) ──────────────────────────────────────────────
CREATE TABLE public.doc_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT NOT NULL DEFAULT '📁',
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.docs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.doc_categories(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','published')),
  visibility  TEXT NOT NULL DEFAULT 'team'
                   CHECK (visibility IN ('team','private')),
  author_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 10. Banners + notifications + audit ─────────────────────────────────────
CREATE TABLE public.banners (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url  TEXT NOT NULL,
  title      TEXT,
  position   INT NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  sender_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_broadcast BOOLEAN NOT NULL DEFAULT FALSE,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name   TEXT,
  user_email  TEXT,
  action_type TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_name TEXT,
  object_id   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 11. Calendar / events ───────────────────────────────────────────────────
CREATE TABLE public.events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  description       TEXT,
  priority          TEXT NOT NULL DEFAULT 'medium'
                          CHECK (priority IN ('low','medium','high','urgent')),
  attendance_mode   TEXT NOT NULL DEFAULT 'manual'
                          CHECK (attendance_mode IN ('attendance','absence','manual')),
  attendance_points INTEGER NOT NULL DEFAULT 0,
  location_type     TEXT NOT NULL DEFAULT 'in_person'
                          CHECK (location_type IN ('online','in_person')),
  meeting_url       TEXT,
  location          TEXT,
  event_date        DATE NOT NULL,
  event_time        TIME,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.event_departments (
  event_id      UUID NOT NULL REFERENCES public.events(id)      ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, department_id)
);

CREATE TABLE public.event_goals (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  goal_id  UUID NOT NULL REFERENCES public.goals(id)  ON DELETE CASCADE,
  PRIMARY KEY (event_id, goal_id)
);

CREATE TABLE public.event_projects (
  event_id   UUID NOT NULL REFERENCES public.events(id)    ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  PRIMARY KEY (event_id, project_id)
);

CREATE TABLE public.event_attendees (
  event_id       UUID NOT NULL REFERENCES public.events(id)   ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'invited'
                       CHECK (status IN ('invited','attended','absent')),
  awarded_points INTEGER NOT NULL DEFAULT 0,
  marked_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  marked_at      TIMESTAMPTZ,
  PRIMARY KEY (event_id, user_id)
);


-- ── 12. Ideas + rewards/store ───────────────────────────────────────────────
CREATE TABLE public.ideas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                TEXT NOT NULL,
  description          TEXT,
  category             TEXT,
  department_id        UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  created_by           UUID REFERENCES public.profiles(id)    ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'proposed'
                            CHECK (status IN ('proposed','implemented','rejected')),
  reward_points        INTEGER NOT NULL DEFAULT 0,
  implementation_notes TEXT,
  implemented_at       TIMESTAMPTZ,
  implemented_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.idea_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id    UUID NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  value      SMALLINT NOT NULL DEFAULT 1 CHECK (value IN (1, -1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (idea_id, user_id)
);

CREATE TABLE public.rewards (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  description     TEXT,
  image_url       TEXT,
  required_points INTEGER NOT NULL DEFAULT 0,
  stock           INTEGER,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.reward_orders (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reward_id  UUID NOT NULL REFERENCES public.rewards(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','delivered')),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 13. Finances ────────────────────────────────────────────────────────────
CREATE TABLE public.finance_dues (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform          TEXT NOT NULL,
  amount            NUMERIC NOT NULL DEFAULT 0,
  type              TEXT NOT NULL DEFAULT 'monthly',
  interval_days     INTEGER,
  category          TEXT,
  status            TEXT NOT NULL DEFAULT 'unpaid'
                          CHECK (status IN ('paid','unpaid','overdue')),
  last_payment_date DATE,
  next_payment_date DATE,
  payment_link      TEXT,
  notes             TEXT,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.finance_income (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source        TEXT NOT NULL,
  amount        NUMERIC NOT NULL DEFAULT 0,
  type          TEXT NOT NULL DEFAULT 'monthly',
  interval_days INTEGER,
  created_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.finance_goals (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'monthly',
  target_amount  NUMERIC NOT NULL DEFAULT 0,
  current_amount NUMERIC NOT NULL DEFAULT 0,
  deadline       DATE,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.finance_goal_steps (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id    UUID NOT NULL REFERENCES public.finance_goals(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  completed  BOOLEAN NOT NULL DEFAULT FALSE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.finance_opportunities (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  requirements TEXT,
  notes        TEXT,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 14. Furn (الفرن) — quotation engine ─────────────────────────────────────
CREATE TABLE public.furn_settings (
  id                          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  header_image_url            TEXT,
  signature_image_url         TEXT,
  manager_name                TEXT,
  company_phone               TEXT,
  company_email               TEXT,
  commercial_register         TEXT,
  tax_number                  TEXT,
  footer_address              TEXT,
  default_payment_terms       TEXT,
  default_delivery_terms      TEXT,
  default_offer_duration      TEXT,
  default_special_conditions  TEXT,
  next_quotation_number       INT NOT NULL DEFAULT 1700,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                  UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE public.furn_departments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en    TEXT NOT NULL UNIQUE,
  name_ar    TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS public.furn_projects_number_seq START 1;
CREATE TABLE public.furn_projects (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-facing sequential identifier. Monotonic, never reused even after
  -- deletion, displayed in the table list as a zero-padded 6-digit string
  -- (000001, 000002, …). Distinct from the row id (UUID) which we keep
  -- internal so URLs stay opaque.
  project_number           BIGINT NOT NULL UNIQUE DEFAULT nextval('public.furn_projects_number_seq'),
  project_name             TEXT NOT NULL,
  company_name             TEXT NOT NULL,
  engineer_name            TEXT,
  engineer_phone           TEXT,
  commercial_register      TEXT,
  tax_number               TEXT,
  subject                  TEXT,
  department_ids           UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  -- Single-language columns are kept for backward compat with existing
  -- rows. New bilingual columns below are what the form writes to from
  -- now on; the PDF renderer prefers the matching language and falls back
  -- to the legacy single-language value when an _en/_ar isn't filled.
  payment_terms            TEXT,
  delivery_terms           TEXT,
  offer_duration           TEXT,
  special_conditions       TEXT,
  payment_terms_en         TEXT,
  payment_terms_ar         TEXT,
  delivery_terms_en        TEXT,
  delivery_terms_ar        TEXT,
  offer_duration_en        TEXT,
  offer_duration_ar        TEXT,
  special_conditions_en    TEXT,
  special_conditions_ar    TEXT,
  stage                    TEXT NOT NULL DEFAULT 'processing'
                                CHECK (stage IN ('processing','pricing','quoted')),
  status                   TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','in_progress','completed','rejected','archived')),
  boq_url                  TEXT,
  boq_filename             TEXT,
  spec_files               JSONB NOT NULL DEFAULT '[]'::jsonb,
  drawing_files            JSONB NOT NULL DEFAULT '[]'::jsonb,
  other_files              JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Optional pointer back to the originating client project, set when the
  -- user creates this Furn project via "import from client project".
  source_client_project_id UUID REFERENCES public.client_projects(id) ON DELETE SET NULL,
  ai_summary               TEXT,
  ai_detected_departments  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ai_error                 TEXT,
  created_by               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.furn_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.furn_projects(id) ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 1,
  -- `description` is the short item title shown as the main label in both
  -- the pricing table and the quotation PDF. `details` is the long AI-generated
  -- description rendered underneath in a smaller font. `notes` is reserved
  -- as a clean, user-editable field — the AI never writes to it, only the
  -- team does when they want to flag something on a specific line.
  description   TEXT NOT NULL,
  details       TEXT,
  quantity      NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit          TEXT NOT NULL DEFAULT 'm',
  unit_price    NUMERIC(14,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  notes         TEXT,
  ai_confidence NUMERIC(4,3) CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.furn_quotations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES public.furn_projects(id) ON DELETE CASCADE,
  -- quotation_number is shared between the AR and EN PDFs of the same
  -- offer, so it's NOT unique on its own. The (project_id, quotation_number,
  -- language) triple is what's globally unique — a project can have one
  -- AR row and one EN row per number, and re-issuing the same quotation
  -- updates those rows instead of allocating a new pair.
  quotation_number INT NOT NULL,
  language         TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar','en')),
  UNIQUE (project_id, quotation_number, language),
  vat_rate         NUMERIC(5,4) NOT NULL DEFAULT 0.15,
  subtotal         NUMERIC(16,2) NOT NULL DEFAULT 0,
  vat_amount       NUMERIC(16,2) NOT NULL DEFAULT 0,
  total            NUMERIC(16,2) NOT NULL DEFAULT 0,
  pdf_url          TEXT,
  generated_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 15. Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX idx_profiles_role             ON public.profiles(role);
CREATE INDEX idx_profiles_last_seen        ON public.profiles(last_seen_at DESC);
CREATE INDEX idx_dept_members_dept         ON public.department_members(department_id);
CREATE INDEX idx_dept_members_user         ON public.department_members(user_id);
CREATE INDEX idx_projects_dept             ON public.projects(department_id);
CREATE INDEX idx_tasks_project             ON public.tasks(project_id);
CREATE INDEX idx_tasks_assigned            ON public.tasks(assigned_user_id);
CREATE INDEX idx_daily_tasks_assigned      ON public.daily_tasks(assigned_user_id);
CREATE INDEX idx_daily_tasks_expires       ON public.daily_tasks(expires_at);
CREATE INDEX idx_pending_points_status     ON public.pending_points(status);
CREATE INDEX idx_pending_points_user       ON public.pending_points(user_id);
CREATE INDEX idx_audit_logs_created        ON public.audit_logs(created_at DESC);
CREATE INDEX idx_notifications_recipient   ON public.notifications(recipient_id);
CREATE INDEX idx_notifications_created     ON public.notifications(created_at DESC);
CREATE INDEX idx_stories_expires           ON public.stories(expires_at);
CREATE INDEX idx_stories_user              ON public.stories(user_id);
CREATE INDEX idx_posts_created             ON public.posts(created_at DESC);
CREATE INDEX idx_post_likes_post           ON public.post_likes(post_id);
CREATE INDEX idx_post_comments_post        ON public.post_comments(post_id);
CREATE INDEX idx_post_poll_options_post    ON public.post_poll_options(post_id);
CREATE INDEX idx_post_poll_votes_option    ON public.post_poll_votes(option_id);
CREATE INDEX idx_story_views_user          ON public.story_views(user_id);
CREATE INDEX idx_story_views_story         ON public.story_views(story_id);
CREATE INDEX idx_chat_members_user         ON public.chat_members(user_id);
CREATE INDEX idx_chat_members_conv         ON public.chat_members(conversation_id);
CREATE INDEX idx_chat_messages_conv_created ON public.chat_messages(conversation_id, created_at DESC);
CREATE INDEX idx_ai_conversations_user     ON public.ai_conversations(user_id, updated_at DESC);
CREATE INDEX idx_ai_messages_conv          ON public.ai_messages(conversation_id, created_at);
CREATE INDEX idx_doc_categories_position   ON public.doc_categories(position);
CREATE INDEX idx_docs_category             ON public.docs(category_id);
CREATE INDEX idx_docs_status               ON public.docs(status);
CREATE INDEX idx_banners_active_position   ON public.banners(is_active, position);
CREATE INDEX idx_events_date               ON public.events(event_date);
CREATE INDEX idx_events_creator            ON public.events(created_by);
CREATE INDEX idx_event_attendees_user      ON public.event_attendees(user_id);
CREATE INDEX idx_ideas_status              ON public.ideas(status);
CREATE INDEX idx_ideas_category            ON public.ideas(category);
CREATE INDEX idx_ideas_created             ON public.ideas(created_at DESC);
CREATE INDEX idx_ideas_department          ON public.ideas(department_id);
CREATE INDEX idx_idea_votes_idea           ON public.idea_votes(idea_id);
CREATE INDEX idx_user_badges_user          ON public.user_badges(user_id);
CREATE INDEX idx_dept_doodles_dept         ON public.department_doodles(department_id);
CREATE INDEX idx_dept_doodles_created      ON public.department_doodles(created_at DESC);
CREATE INDEX idx_goals_paused              ON public.goals(paused);
CREATE INDEX idx_goal_step_tasks_step      ON public.goal_step_tasks(step_id);
CREATE INDEX idx_goal_step_tasks_assignee  ON public.goal_step_tasks(assigned_user_id);
CREATE INDEX idx_furn_projects_created_at  ON public.furn_projects(created_at DESC);
CREATE INDEX idx_furn_projects_stage       ON public.furn_projects(stage);
CREATE INDEX idx_furn_projects_status      ON public.furn_projects(status);
CREATE INDEX idx_furn_projects_company     ON public.furn_projects(company_name);
CREATE INDEX idx_furn_items_project        ON public.furn_items(project_id, position);
CREATE INDEX idx_furn_quotations_project   ON public.furn_quotations(project_id, generated_at DESC);


-- ── 16. RLS — open to authenticated; app layer enforces fine-grained perms ──
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t || '_auth_all', t
    );
  END LOOP;
END $$;

-- AI chat is private per-user (override the permissive default).
DROP POLICY ai_conversations_auth_all ON public.ai_conversations;
DROP POLICY ai_messages_auth_all      ON public.ai_messages;

CREATE POLICY ai_conversations_own ON public.ai_conversations
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY ai_messages_own ON public.ai_messages
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_conversations c
                 WHERE c.id = conversation_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_conversations c
                      WHERE c.id = conversation_id AND c.user_id = auth.uid()));


-- ── 17. Helper functions + triggers ─────────────────────────────────────────

-- 19.1 is_super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  )
$$;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- 19.2 Auto-create profile on signup. Bootstraps the first admin: if the
-- email matches our admin allowlist, the profile is created as super_admin.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    CASE
      WHEN LOWER(NEW.email) IN ('elzubair.mail@gmail.com', 'it@ghassl.com') THEN 'super_admin'
      ELSE COALESCE(NEW.raw_user_meta_data->>'role', 'employee')
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 19.3 Project task completion → pending_points
CREATE OR REPLACE FUNCTION public.handle_task_completion()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_name TEXT; v_user_email TEXT; v_off_days JSONB;
  v_today_dow INTEGER; v_is_off_day BOOLEAN := FALSE; v_points INTEGER;
BEGIN
  IF NEW.status = 'done' AND OLD.status != 'done'
     AND NEW.assigned_user_id IS NOT NULL AND NOT NEW.points_awarded AND NEW.points > 0 THEN
    SELECT full_name, email, COALESCE(off_days, '[]'::jsonb)
      INTO v_user_name, v_user_email, v_off_days
    FROM public.profiles WHERE id = NEW.assigned_user_id;

    v_today_dow  := EXTRACT(DOW FROM NOW())::INTEGER;
    v_is_off_day := (v_off_days ? v_today_dow::TEXT);
    v_points     := CASE WHEN v_is_off_day THEN NEW.points * 2 ELSE NEW.points END;

    INSERT INTO public.pending_points
      (user_id, user_name, user_email, object_type, object_name, object_id, points, is_off_day)
    VALUES
      (NEW.assigned_user_id, v_user_name, v_user_email,
       'task', NEW.title, NEW.id, v_points, v_is_off_day);
  END IF;

  IF OLD.status = 'done' AND NEW.status != 'done' AND OLD.assigned_user_id IS NOT NULL THEN
    DELETE FROM public.pending_points
      WHERE object_id = OLD.id AND user_id = OLD.assigned_user_id AND status = 'pending';
    IF OLD.points_awarded THEN
      UPDATE public.profiles
        SET total_points = GREATEST(0, total_points - OLD.points), updated_at = NOW()
        WHERE id = OLD.assigned_user_id;
      NEW.points_awarded := FALSE;
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_task_updated ON public.tasks;
CREATE TRIGGER on_task_updated
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_task_completion();

-- 19.4 Bump chat conversation on new message (so we can sort by latest)
CREATE OR REPLACE FUNCTION public.bump_conversation_on_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.chat_conversations SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_conv ON public.chat_messages;
CREATE TRIGGER trg_bump_conv
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_on_message();

-- 19.5 Generic updated_at toucher (used by several tables)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER touch_dept_doodles BEFORE UPDATE ON public.department_doodles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_events       BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_furn_projects BEFORE UPDATE ON public.furn_projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_furn_items   BEFORE UPDATE ON public.furn_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_furn_settings BEFORE UPDATE ON public.furn_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 19.6 Award points on post / story creation (gated by app_config knobs)
CREATE OR REPLACE FUNCTION public.award_post_creation_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_reward INT; v_limit INT; v_today INT;
BEGIN
  SELECT post_reward_points, post_reward_daily_limit INTO v_reward, v_limit
  FROM public.app_config WHERE id = 1;
  IF COALESCE(v_reward, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_today FROM public.posts
   WHERE user_id = NEW.user_id
     AND created_at >= CURRENT_DATE
     AND created_at <  CURRENT_DATE + INTERVAL '1 day';

  IF COALESCE(v_limit, 0) > 0 AND v_today > v_limit THEN RETURN NEW; END IF;

  UPDATE public.profiles
     SET total_points = COALESCE(total_points, 0) + v_reward
   WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.award_story_creation_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_reward INT; v_limit INT; v_today INT;
BEGIN
  SELECT story_reward_points, story_reward_daily_limit INTO v_reward, v_limit
  FROM public.app_config WHERE id = 1;
  IF COALESCE(v_reward, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_today FROM public.stories
   WHERE user_id = NEW.user_id
     AND created_at >= CURRENT_DATE
     AND created_at <  CURRENT_DATE + INTERVAL '1 day';

  IF COALESCE(v_limit, 0) > 0 AND v_today > v_limit THEN RETURN NEW; END IF;

  UPDATE public.profiles
     SET total_points = COALESCE(total_points, 0) + v_reward
   WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER award_post_points  AFTER INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.award_post_creation_points();
CREATE TRIGGER award_story_points AFTER INSERT ON public.stories
  FOR EACH ROW EXECUTE FUNCTION public.award_story_creation_points();


-- ── 18. Realtime for chat ───────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;       EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_members;        EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;


-- ── 19. Storage buckets + their RLS ─────────────────────────────────────────
-- Buckets used by the upload route in src/app/api/upload/route.ts.
-- All are public-read so the AI analyzer / print page / browser can fetch
-- the assets back over plain HTTPS.

INSERT INTO storage.buckets (id, name, public) VALUES
  ('avatars',       'avatars',       TRUE),
  ('posts',         'posts',         TRUE),
  ('stories',       'stories',       TRUE),
  ('chat',          'chat',          TRUE),
  ('rewards',       'rewards',       TRUE),
  ('goals',         'goals',         TRUE),
  ('banners',       'banners',       TRUE),
  ('doodles',       'doodles',       TRUE),
  ('furn',          'furn',          TRUE),
  ('furn-branding', 'furn-branding', TRUE)
ON CONFLICT (id) DO NOTHING;

-- One permissive policy per CRUD verb covering every Kaaseb bucket. The app
-- layer (verifyOrigin + per-route auth checks) is what actually constrains
-- who uploads what.

DROP POLICY IF EXISTS kaaseb_storage_read   ON storage.objects;
DROP POLICY IF EXISTS kaaseb_storage_write  ON storage.objects;
DROP POLICY IF EXISTS kaaseb_storage_update ON storage.objects;
DROP POLICY IF EXISTS kaaseb_storage_delete ON storage.objects;

CREATE POLICY kaaseb_storage_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id IN ('avatars','posts','stories','chat','rewards','goals','banners','doodles','furn','furn-branding'));

CREATE POLICY kaaseb_storage_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('avatars','posts','stories','chat','rewards','goals','banners','doodles','furn','furn-branding'));

CREATE POLICY kaaseb_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id IN ('avatars','posts','stories','chat','rewards','goals','banners','doodles','furn','furn-branding'))
  WITH CHECK (bucket_id IN ('avatars','posts','stories','chat','rewards','goals','banners','doodles','furn','furn-branding'));

CREATE POLICY kaaseb_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id IN ('avatars','posts','stories','chat','rewards','goals','banners','doodles','furn','furn-branding'));


-- ── 20. Seed Furn defaults ──────────────────────────────────────────────────
INSERT INTO public.furn_settings (id, footer_address, manager_name, company_phone, company_email, commercial_register, tax_number)
VALUES (
  1,
  E'عمارة التقدم، طريق الخرج، حي المناخ',
  'SALEH ALHAIDAR',
  '0506268080',
  'info@kaaseb.sa',
  '1010937795',
  NULL
);

INSERT INTO public.furn_departments (name_en, name_ar, is_default, enabled) VALUES
  ('Marble',  'رخام',   TRUE, TRUE),
  ('Granite', 'جرانيت', TRUE, TRUE);


-- ── 21. Bootstrap profiles + admin ──────────────────────────────────────────
-- Backfill profiles for users that already exist in auth.users (signups that
-- happened before this script ran). The is_super_admin allowlist is the
-- single source of truth for who gets promoted automatically.

INSERT INTO public.profiles (id, email, full_name, role)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  CASE
    WHEN LOWER(u.email) IN ('elzubair.mail@gmail.com', 'it@ghassl.com') THEN 'super_admin'
    ELSE COALESCE(u.raw_user_meta_data->>'role', 'employee')
  END
FROM auth.users u
ON CONFLICT (id) DO UPDATE
SET role = CASE
  WHEN LOWER(public.profiles.email) IN ('elzubair.mail@gmail.com', 'it@ghassl.com')
  THEN 'super_admin'
  ELSE public.profiles.role
END;


-- ── 22. Client Projects + Important Documents + Tannoor ────────────────────
-- The contents of migration_projects_tannoor_docs.sql, inlined so fresh
-- installs need only run SCHEMA.sql. See that file for narrative comments.

CREATE SEQUENCE IF NOT EXISTS public.client_projects_number_seq START 1;
CREATE TABLE public.client_projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic 6-digit ID (000001…) shared with /furn and /tannoor — see the
  -- furn_projects table for the rationale.
  project_number      BIGINT NOT NULL UNIQUE DEFAULT nextval('public.client_projects_number_seq'),
  name_en             TEXT,
  name_ar             TEXT,
  company_en          TEXT,
  company_ar          TEXT,
  engineer_name_en    TEXT,
  engineer_name_ar    TEXT,
  engineer_phone      TEXT,
  end_date            DATE,
  pricing_currency    TEXT NOT NULL DEFAULT 'SAR' CHECK (pricing_currency IN ('SAR','USD')),
  status              TEXT NOT NULL DEFAULT 'new',
  -- The default stage is "receive_quotes" (استلام العروض السعرية) because
  -- most projects already arrive with plans + takeoff done — pricing is
  -- the first thing the team actually has to action.
  stage               TEXT NOT NULL DEFAULT 'receive_quotes',
  -- Single free-text keyword bag (comma- or space-separated). Not split
  -- per-language because clients tag with arbitrary phrases that don't
  -- translate cleanly.
  keywords            TEXT,
  notes               TEXT,
  files               JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The internal team member who owns this project — chosen from the
  -- "responsible" dropdown on the new-project form. Nullable so older rows
  -- (and projects with no clear owner) keep working.
  responsible_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_client_projects_status      ON public.client_projects(status);
CREATE INDEX idx_client_projects_responsible ON public.client_projects(responsible_user_id);
CREATE INDEX idx_client_projects_stage       ON public.client_projects(stage);
CREATE INDEX idx_client_projects_end_date ON public.client_projects(end_date);
CREATE INDEX idx_client_projects_created  ON public.client_projects(created_at DESC);

CREATE TABLE public.important_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en      TEXT,
  name_ar      TEXT,
  file_url     TEXT NOT NULL,
  file_name    TEXT,
  file_key     TEXT,
  expiry_date  DATE,
  notes        TEXT,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_important_docs_expiry ON public.important_documents(expiry_date);

CREATE TABLE public.pre_qualifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_en        TEXT,
  company_ar        TEXT,
  project_name_en   TEXT,
  project_name_ar   TEXT,
  document_ids      UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  stamp_mode        TEXT NOT NULL DEFAULT 'last' CHECK (stamp_mode IN ('last','all','none')),
  output_pdf_url    TEXT,
  output_pdf_key    TEXT,
  generated_at      TIMESTAMPTZ,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pre_qual_created ON public.pre_qualifications(created_at DESC);

CREATE TABLE public.tannoor_pricing_methods (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en        TEXT,
  name_ar        TEXT,
  description_en TEXT,
  description_ar TEXT,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.tannoor_products (
  -- Each row is a single VARIANT (effectively a SKU) — the same base
  -- material can appear many times with different colour / finish /
  -- thickness / size / availability and its own price. See
  -- ADD_TANNOOR_PRODUCT_VARIANTS.sql for the why.
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en           TEXT,
  name_ar           TEXT,
  description_en    TEXT,
  description_ar    TEXT,
  department_id     UUID REFERENCES public.furn_departments(id) ON DELETE SET NULL,
  pricing_method_id UUID REFERENCES public.tannoor_pricing_methods(id) ON DELETE SET NULL,
  unit              TEXT NOT NULL DEFAULT 'm',
  thickness_mm      NUMERIC,
  size_w_mm         NUMERIC(10, 2) CHECK (size_w_mm IS NULL OR size_w_mm >= 0),
  size_l_mm         NUMERIC(10, 2) CHECK (size_l_mm IS NULL OR size_l_mm >= 0),
  color_en          TEXT,
  color_ar          TEXT,
  finish            TEXT,
  -- Stock signal — surfaced as a coloured pill in the products UI so the
  -- sales team can see at-a-glance what's plentiful vs. one-off.
  availability      TEXT CHECK (availability IS NULL
                                OR availability IN ('high','medium','low','out_of_stock')),
  price_sar         NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (price_sar >= 0),
  price_usd         NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (price_usd >= 0),
  notes             TEXT,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tannoor_products_dept   ON public.tannoor_products(department_id);
CREATE INDEX idx_tannoor_products_method ON public.tannoor_products(pricing_method_id);

CREATE SEQUENCE IF NOT EXISTS public.tannoor_projects_number_seq START 1;
CREATE TABLE public.tannoor_projects (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic 6-digit ID (000001…) — see furn_projects for rationale.
  project_number           BIGINT NOT NULL UNIQUE DEFAULT nextval('public.tannoor_projects_number_seq'),
  project_name_en          TEXT,
  project_name_ar          TEXT,
  company_en               TEXT,
  company_ar               TEXT,
  engineer_name_en         TEXT,
  engineer_name_ar         TEXT,
  engineer_phone           TEXT,
  commercial_register      TEXT,
  tax_number               TEXT,
  subject                  TEXT,
  payment_terms            TEXT,
  delivery_terms           TEXT,
  offer_duration           TEXT,
  special_conditions       TEXT,
  stage                    TEXT NOT NULL DEFAULT 'processing'
                                CHECK (stage IN ('processing','quoted')),
  status                   TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','in_progress','completed','rejected','archived','missing_products')),
  boq_url                  TEXT,
  boq_filename             TEXT,
  spec_files               JSONB NOT NULL DEFAULT '[]'::jsonb,
  drawing_files            JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_summary               TEXT,
  ai_detected_departments  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ai_missing_items         JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_error                 TEXT,
  created_by               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tannoor_projects_created ON public.tannoor_projects(created_at DESC);
CREATE INDEX idx_tannoor_projects_stage   ON public.tannoor_projects(stage);
CREATE INDEX idx_tannoor_projects_status  ON public.tannoor_projects(status);

CREATE TABLE public.tannoor_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.tannoor_projects(id) ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 1,
  description   TEXT NOT NULL,
  quantity      NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit          TEXT NOT NULL DEFAULT 'm',
  product_id    UUID REFERENCES public.tannoor_products(id) ON DELETE SET NULL,
  unit_price    NUMERIC(14,2),
  currency      TEXT NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR','USD')),
  notes         TEXT,
  is_missing    BOOLEAN NOT NULL DEFAULT FALSE,
  ai_confidence NUMERIC(4,3),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tannoor_items_project ON public.tannoor_items(project_id, position);

CREATE TABLE public.tannoor_quotations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES public.tannoor_projects(id) ON DELETE CASCADE,
  -- Same shared-number model as furn_quotations — see that table's comment.
  quotation_number INT NOT NULL,
  language         TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar','en')),
  UNIQUE (project_id, quotation_number, language),
  currency         TEXT NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR','USD')),
  vat_rate         NUMERIC(5,4) NOT NULL DEFAULT 0.15,
  subtotal         NUMERIC(16,2) NOT NULL DEFAULT 0,
  vat_amount       NUMERIC(16,2) NOT NULL DEFAULT 0,
  total            NUMERIC(16,2) NOT NULL DEFAULT 0,
  pdf_url          TEXT,
  generated_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tannoor_quotations_project ON public.tannoor_quotations(project_id, generated_at DESC);

ALTER TABLE public.furn_settings
  ADD COLUMN IF NOT EXISTS seal_image_url      TEXT,
  ADD COLUMN IF NOT EXISTS next_tannoor_number INT NOT NULL DEFAULT 5000;

-- Enable RLS + permissive policies for the new tables (matches section 18).
ALTER TABLE public.client_projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.important_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_qualifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tannoor_pricing_methods  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tannoor_products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tannoor_projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tannoor_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tannoor_quotations       ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_projects_auth_all          ON public.client_projects          FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY important_documents_auth_all      ON public.important_documents      FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY pre_qualifications_auth_all       ON public.pre_qualifications       FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY tannoor_pricing_methods_auth_all  ON public.tannoor_pricing_methods  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY tannoor_products_auth_all         ON public.tannoor_products         FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY tannoor_projects_auth_all         ON public.tannoor_projects         FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY tannoor_items_auth_all            ON public.tannoor_items            FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY tannoor_quotations_auth_all       ON public.tannoor_quotations       FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE TRIGGER touch_client_projects    BEFORE UPDATE ON public.client_projects         FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_important_docs     BEFORE UPDATE ON public.important_documents     FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_pre_qualifications BEFORE UPDATE ON public.pre_qualifications      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_methods    BEFORE UPDATE ON public.tannoor_pricing_methods FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_products   BEFORE UPDATE ON public.tannoor_products        FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_projects   BEFORE UPDATE ON public.tannoor_projects        FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_items      BEFORE UPDATE ON public.tannoor_items           FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ── 22.5 AI settings (singleton) — provider switch + encrypted OpenAI key ────
CREATE TABLE IF NOT EXISTS public.ai_settings (
  id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider         TEXT NOT NULL DEFAULT 'openai' CHECK (provider IN ('openai', 'gemini')),
  openai_api_key   TEXT,                          -- AES-256-GCM envelope (src/lib/encryption.ts)
  openai_model     TEXT NOT NULL DEFAULT 'gpt-5.4-mini',
  openai_boq_model TEXT NOT NULL DEFAULT 'gpt-5.4',
  gemini_model     TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
INSERT INTO public.ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_settings_auth_all ON public.ai_settings FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE TRIGGER touch_ai_settings BEFORE UPDATE ON public.ai_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ── 23. Tell PostgREST the schema changed ───────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- Done. Sanity check: the row count below should show a long list of tables,
-- all with 0 rows except `profiles` (one row per existing auth user) and the
-- pre-seeded singletons (`app_config`, `furn_settings`, `furn_departments`).
SELECT 'Kaaseb schema ready.' AS status;
