create table public.rescan_sessions (
 id uuid primary key,
 owner_id text not null,
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
create index on public.rescan_sessions(owner_id, created_at desc);
create table public.rescan_lenses (
 id uuid primary key,
 session_id uuid not null references public.rescan_sessions(id),
 scanned_at timestamptz not null default now(),
 model text not null check (length(trim(model)) between 1 and 80),
 power numeric(7,3) not null check (power between -100 and 100),
 serial text not null check (length(trim(serial)) between 1 and 100),
 unique(session_id, serial)
);
create index on public.rescan_lenses(session_id, scanned_at);
alter table public.rescan_sessions enable row level security;
alter table public.rescan_lenses enable row level security;
revoke all on public.rescan_sessions, public.rescan_lenses from anon, authenticated;
-- Сервер использует service_role; блокировка строки сериализует добавление и завершение.
create function public.rescan_add_lens(p_owner text, p_session uuid, p_id uuid, p_model text, p_power numeric, p_serial text)
returns public.rescan_lenses language plpgsql set search_path = public as $$
declare s public.rescan_sessions; result public.rescan_lenses;
begin
 select * into s from public.rescan_sessions where id=p_session and owner_id=p_owner for update;
 if not found then raise exception 'Сессия не найдена'; end if;
 select * into result from public.rescan_lenses where id=p_id and session_id=p_session;
 if found then return result; end if;
 if s.completed_at is not null then raise exception 'Сессия уже завершена'; end if;
 insert into public.rescan_lenses(id,session_id,model,power,serial) values(p_id,p_session,p_model,p_power,p_serial) returning * into result;
 return result;
end; $$;
revoke all on function public.rescan_add_lens(text,uuid,uuid,text,numeric,text) from public, anon, authenticated;
grant execute on function public.rescan_add_lens(text,uuid,uuid,text,numeric,text) to service_role;
