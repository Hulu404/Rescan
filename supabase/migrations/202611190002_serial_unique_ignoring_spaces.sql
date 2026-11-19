-- The same lens must not be added twice to a session, however the SN was spaced or cased:
-- "26168203001", "26168203 001" and "26168203  001" are one serial.
-- If a session already holds such duplicates, the index creation fails and lists them; resolve them first:
--   select session_id, upper(regexp_replace(serial, '\s', '', 'g')) as sn, count(*)
--   from public.rescan_lenses group by 1, 2 having count(*) > 1;
alter table public.rescan_lenses drop constraint if exists rescan_lenses_session_id_serial_key;
create unique index rescan_lenses_session_serial_key
  on public.rescan_lenses (session_id, upper(regexp_replace(serial, '\s', '', 'g')));
