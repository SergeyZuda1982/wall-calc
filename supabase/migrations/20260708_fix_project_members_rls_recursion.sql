-- Фикс: политики RLS для project_members ссылались сами на себя
-- (select ... from project_members внутри политики ДЛЯ project_members) —
-- Postgres ловит это как "infinite recursion detected in policy for
-- relation project_members", запрос падает целиком. Проявилось в панели
-- «Участники» как «Не удалось загрузить участников» (08.07.2026).
--
-- Решение: is_project_member()/get_project_role() — функции security
-- definer, которые читают project_members НАПРЯМУЮ, в обход RLS (они
-- выполняются с правами владельца функции, а не вызывающего). Политики
-- теперь зовут функцию вместо прямого подзапроса к самой себе.
--
-- Выполнить целиком в Supabase SQL editor (после миграции от 07.07.2026).

create or replace function is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from project_members
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;

create or replace function has_project_role(p_project_id uuid, p_roles text[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from project_members
    where project_id = p_project_id
      and user_id = auth.uid()
      and role = any(p_roles)
      and status = 'active'
  );
$$;

-- ─── project_members ────────────────────────────────────────────────────

drop policy if exists project_members_select on project_members;
create policy project_members_select on project_members
  for select using (is_project_member(project_id));

drop policy if exists project_members_write on project_members;
create policy project_members_write on project_members
  for all using (has_project_role(project_id, array['owner', 'foreman', 'management']));

-- ─── estimates ──────────────────────────────────────────────────────────

drop policy if exists estimates_select on estimates;
create policy estimates_select on estimates
  for select using (is_project_member(project_id));

drop policy if exists estimates_write on estimates;
create policy estimates_write on estimates
  for all using (has_project_role(project_id, array['owner', 'foreman', 'management']));

-- ─── estimate_access ────────────────────────────────────────────────────
-- (эти две политики не ссылались на project_members рекурсивно — не
-- участвуют в баге, но переносим тоже на условия через estimates + функцию,
-- чтобы не было расхождений в стиле; поведение не меняется)

drop policy if exists estimate_access_write on estimate_access;
create policy estimate_access_write on estimate_access
  for all using (
    exists (
      select 1 from estimates e
      where e.id = estimate_access.estimate_id
        and has_project_role(e.project_id, array['owner', 'foreman', 'management'])
    )
  );
