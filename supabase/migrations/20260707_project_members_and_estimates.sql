-- Роли, участники объекта и сметы — см. KONSPEKT «роли, права доступа и
-- сметы» от 07.07.2026 (v2). Выполнить целиком в Supabase SQL editor.
--
-- ВАЖНО: таблица projects сейчас содержит только user_id (единственный
-- владелец). Этот скрипт добавляет project_members и переносит текущих
-- владельцев в неё первой записью с ролью 'owner'. Таблицу projects.user_id
-- НЕ удаляем и не трогаем в этой миграции — она остаётся как есть, переход
-- фронтенда на project_members как источник правды делается отдельным
-- шагом в коде (RLS-политики самих projects/walls/linings под project_members
-- обновляются отдельной миграцией, после того как проверим эту на практике).

-- ─── 1. project_members ──────────────────────────────────────────────────

create table if not exists project_members (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,

  -- null, пока приглашённый не зашёл в первый раз
  user_id       uuid references auth.users(id),
  invited_email text,

  role          text not null check (role in (
                  'owner', 'foreman', 'installer',
                  'management', 'supply', 'designer', 'subcontractor'
                )),

  -- свободное описание специальности (плиточник/электрик/...), не влияет на права
  specialty     text,

  -- прораб субподрядчика: права на план/статусы как у foreman, но без
  -- наследования прав на сметы (см. estimates ниже) и с ограничением на
  -- управление только своими сотрудниками (team_lead_id у подчинённых)
  is_team_lead  boolean not null default false,

  -- у рядового участника субподрядчика — ссылка на его прораба
  -- (другую запись project_members с is_team_lead = true)
  team_lead_id  uuid references project_members(id),

  status        text not null default 'invited' check (status in ('invited', 'active')),
  invited_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),

  unique (project_id, user_id),
  unique (project_id, invited_email)
);

create index if not exists idx_project_members_project on project_members(project_id);
create index if not exists idx_project_members_user on project_members(user_id);

-- ─── 2. Триггер проверок, которые нельзя выразить через check ──────────────

create or replace function project_members_validate()
returns trigger as $$
declare
  lead_row project_members%rowtype;
  existing_owner_count int;
begin
  -- is_team_lead только у subcontractor
  if new.is_team_lead and new.role <> 'subcontractor' then
    raise exception 'is_team_lead допустим только при role = subcontractor';
  end if;

  -- team_lead_id только у subcontractor без is_team_lead
  if new.team_lead_id is not null then
    if new.role <> 'subcontractor' or new.is_team_lead then
      raise exception 'team_lead_id допустим только у subcontractor с is_team_lead = false';
    end if;

    select * into lead_row from project_members where id = new.team_lead_id;
    if not found then
      raise exception 'team_lead_id указывает на несуществующую запись';
    end if;
    if lead_row.project_id <> new.project_id then
      raise exception 'team_lead_id должен указывать на запись в том же project_id';
    end if;
    if not lead_row.is_team_lead then
      raise exception 'team_lead_id должен указывать на запись с is_team_lead = true';
    end if;
  end if;

  -- не больше одного активного owner на объект
  if new.role = 'owner' then
    select count(*) into existing_owner_count
    from project_members
    where project_id = new.project_id
      and role = 'owner'
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
    if existing_owner_count > 0 then
      raise exception 'На объекте не может быть двух владельцев одновременно';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_project_members_validate on project_members;
create trigger trg_project_members_validate
  before insert or update on project_members
  for each row execute function project_members_validate();

-- ─── 3. Перенос текущих владельцев projects.user_id в project_members ─────

insert into project_members (project_id, user_id, role, status)
select p.id, p.user_id, 'owner', 'active'
from projects p
where not exists (
  select 1 from project_members pm where pm.project_id = p.id and pm.role = 'owner'
);

-- ─── 4. RLS для project_members ────────────────────────────────────────────
-- Пока НЕ ограничиваем жёстко под полную матрицу прав (раздел 1 конспекта) —
-- это будет доработано вместе с UI-панелью участников. Сейчас: читать может
-- любой участник объекта, писать — владелец/прораб/руководство (без учёта
-- ограничения "только своя команда" для team_lead — добавим отдельно, когда
-- будет готова форма приглашения).

alter table project_members enable row level security;

drop policy if exists project_members_select on project_members;
create policy project_members_select on project_members
  for select using (
    exists (
      select 1 from project_members pm
      where pm.project_id = project_members.project_id
        and pm.user_id = auth.uid()
    )
  );

drop policy if exists project_members_write on project_members;
create policy project_members_write on project_members
  for all using (
    exists (
      select 1 from project_members pm
      where pm.project_id = project_members.project_id
        and pm.user_id = auth.uid()
        and pm.role in ('owner', 'foreman', 'management')
        and pm.status = 'active'
    )
  );

-- ─── 5. estimates / estimate_access / personal_rate_calc ───────────────────

create table if not exists estimates (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  type          text not null check (type in (
                  'customer_full', 'materials_priced', 'labor_priced',
                  'materials_qty', 'calculator_auto'
                )),
  owner_user_id uuid references auth.users(id),
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_estimates_project on estimates(project_id);

create table if not exists estimate_access (
  id           uuid primary key default gen_random_uuid(),
  estimate_id  uuid not null references estimates(id) on delete cascade,
  user_id      uuid not null references auth.users(id),
  granted_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (estimate_id, user_id)
);

create table if not exists personal_rate_calc (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id),
  work_type   text not null,
  rate        numeric not null,
  unit        text not null check (unit in ('m2', 'lm')), -- м²/п.м.
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_personal_rate_calc_project_user on personal_rate_calc(project_id, user_id);

alter table estimates enable row level security;
alter table estimate_access enable row level security;
alter table personal_rate_calc enable row level security;

-- Доступ к estimates по авто-правилам (раздел 3 конспекта) реализуется в
-- следующем шаге вместе с кодом (функция "какие типы видит роль X" должна
-- жить в одном месте и на фронтенде, и в RLS — иначе разъедутся). Пока
-- временная политика: видят все участники объекта, писать может тот, кто
-- создал запись, или владелец/прораб/руководство. Ужесточим политику под
-- полную матрицу раздела 3 отдельным шагом, когда будет готов единый
-- "проверятель прав" на фронтенде — см. src/core/permissions.ts.

drop policy if exists estimates_select on estimates;
create policy estimates_select on estimates
  for select using (
    exists (
      select 1 from project_members pm
      where pm.project_id = estimates.project_id and pm.user_id = auth.uid()
    )
  );

drop policy if exists estimates_write on estimates;
create policy estimates_write on estimates
  for all using (
    exists (
      select 1 from project_members pm
      where pm.project_id = estimates.project_id
        and pm.user_id = auth.uid()
        and pm.role in ('owner', 'foreman', 'management')
    )
  );

drop policy if exists estimate_access_select on estimate_access;
create policy estimate_access_select on estimate_access
  for select using (user_id = auth.uid() or granted_by = auth.uid());

drop policy if exists estimate_access_write on estimate_access;
create policy estimate_access_write on estimate_access
  for all using (
    exists (
      select 1 from estimates e
      join project_members pm on pm.project_id = e.project_id
      where e.id = estimate_access.estimate_id
        and pm.user_id = auth.uid()
        and pm.role in ('owner', 'foreman', 'management')
    )
  );

drop policy if exists personal_rate_calc_own on personal_rate_calc;
create policy personal_rate_calc_own on personal_rate_calc
  for all using (user_id = auth.uid());
