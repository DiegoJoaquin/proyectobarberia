-- Índices para reducir Disk IO en Supabase.
-- Ejecutar UNA vez en Supabase → SQL Editor. Es seguro correrlo de nuevo (IF NOT EXISTS).
-- Sin índices, cada búsqueda por teléfono, cliente, fecha o barbero lee la tabla completa.

-- bookings: listado del admin (ordenado por fecha de creación)
create index if not exists bookings_created_at_idx on public.bookings (created_at desc);

-- bookings: horarios ocupados por barbero y día (web pública y reserva manual)
create index if not exists bookings_barber_date_idx on public.bookings (barber, date);

-- bookings: historial del cliente
create index if not exists bookings_client_id_idx on public.bookings (client_id);
create index if not exists bookings_phone_idx on public.bookings (phone);

-- clients: búsqueda por teléfono y orden por puntos
create index if not exists clients_phone_idx on public.clients (phone);
create index if not exists clients_points_idx on public.clients (points desc);

-- barber_blocks: bloqueos por día
create index if not exists barber_blocks_block_date_idx on public.barber_blocks (block_date);

-- Búsquedas por RUT con ilike '%...%' (necesitan índice trigram)
create extension if not exists pg_trgm;
create index if not exists clients_rut_trgm_idx on public.clients using gin (rut gin_trgm_ops);
create index if not exists bookings_rut_trgm_idx on public.bookings using gin (rut gin_trgm_ops);
