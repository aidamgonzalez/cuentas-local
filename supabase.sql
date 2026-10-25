-- ============================================================
--  Cuentas del Local · estructura de la base de datos
--  Pégalo completo en Supabase → SQL Editor → New query → Run
--  Se puede ejecutar más de una vez sin problema.
-- ============================================================

-- 1) Registros de la app (aportes, gastos, presupuesto, facturas, cobros, configuración)
create table if not exists public.inv_docs (
  path        text primary key,
  coleccion   text generated always as (regexp_replace(path, '/[^/]+$', '')) stored,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists inv_docs_coleccion_idx on public.inv_docs (coleccion);
alter table public.inv_docs replica identity full;

-- 2) Quién tiene acceso (por correo)
create table if not exists public.inv_miembros (
  email   text primary key check (email = lower(email)),
  nombre  text,
  creado  timestamptz not null default now()
);

insert into public.inv_miembros (email, nombre)
values ('aida.m.gonzalezsilva@gmail.com', 'Aida')
on conflict (email) do nothing;

-- 3) ¿El usuario conectado es socia?
create or replace function public.inv_es_miembro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.inv_miembros
    where email = lower(coalesce(auth.jwt()->>'email', ''))
  );
$$;

-- 4) Seguridad: solo las socias ven y cambian los datos
alter table public.inv_docs enable row level security;
alter table public.inv_miembros enable row level security;

drop policy if exists inv_docs_acceso on public.inv_docs;
create policy inv_docs_acceso on public.inv_docs for all to authenticated
  using (public.inv_es_miembro()) with check (public.inv_es_miembro());

drop policy if exists inv_miembros_ver on public.inv_miembros;
create policy inv_miembros_ver on public.inv_miembros for select to authenticated
  using (public.inv_es_miembro());

drop policy if exists inv_miembros_agregar on public.inv_miembros;
create policy inv_miembros_agregar on public.inv_miembros for insert to authenticated
  with check (public.inv_es_miembro());

drop policy if exists inv_miembros_quitar on public.inv_miembros;
create policy inv_miembros_quitar on public.inv_miembros for delete to authenticated
  using (public.inv_es_miembro() and email <> lower(coalesce(auth.jwt()->>'email', '')));

-- 5) Archivos de facturas (privados, máximo 20 MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inv-facturas', 'inv-facturas', false, 20971520,
        array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists inv_facturas_ver on storage.objects;
create policy inv_facturas_ver on storage.objects for select to authenticated
  using (bucket_id = 'inv-facturas' and public.inv_es_miembro());

drop policy if exists inv_facturas_subir on storage.objects;
create policy inv_facturas_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'inv-facturas' and public.inv_es_miembro());

drop policy if exists inv_facturas_cambiar on storage.objects;
create policy inv_facturas_cambiar on storage.objects for update to authenticated
  using (bucket_id = 'inv-facturas' and public.inv_es_miembro())
  with check (bucket_id = 'inv-facturas' and public.inv_es_miembro());

drop policy if exists inv_facturas_borrar on storage.objects;
create policy inv_facturas_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'inv-facturas' and public.inv_es_miembro());

-- 6) Cambios en vivo entre las dos socias
do $$ begin
  alter publication supabase_realtime add table public.inv_docs;
exception when duplicate_object then null; end $$;
