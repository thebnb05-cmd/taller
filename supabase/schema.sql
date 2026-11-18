-- Esquema SQL completo para TH3 BNB Servicio Técnico en Supabase
-- Ejecutar una vez en Supabase Dashboard -> SQL Editor

create extension if not exists pgcrypto;

-- 1. Perfil y marca del taller
create table if not exists public.workshop_profiles (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  role text not null default 'admin',
  brand_name text not null default 'TH3 BNB',
  subtitle text,
  business_phone text,
  business_address text,
  word_colors jsonb not null default '["#0F172A","#0072BB"]'::jsonb,
  logo_data_url text,
  logo_scale integer not null default 100,
  logo_transparent boolean not null default true,
  receipt_terms text,
  tracking_base_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workshop_profiles_owner on public.workshop_profiles(owner_id);

-- 2. Clientes
create table if not exists public.clients (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  dni text,
  email text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_clients_owner on public.clients(owner_id);

-- 3. Órdenes de reparación
create table if not exists public.repairs (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  tracking_code text not null,
  client_id text,
  client_name text not null,
  client_phone text,
  client_dni text,
  client_email text,
  client_address text,
  device_type text not null,
  device_icon text,
  brand text not null,
  model text not null,
  color text,
  capacity text,
  imei text,
  problem text not null,
  priority text not null default 'media',
  status text not null default 'recibido',
  progress integer not null default 15,
  date_in text not null,
  date_est text,
  price numeric not null default 0,
  deposit numeric not null default 0,
  paid_amount numeric not null default 0,
  payment_status text,
  part_ids jsonb not null default '[]'::jsonb,
  part_names jsonb not null default '[]'::jsonb,
  accessories jsonb not null default '[]'::jsonb,
  console_accessories jsonb,
  physical_check jsonb not null default '{}'::jsonb,
  functional_check jsonb not null default '{}'::jsonb,
  security_type text,
  security_pin text,
  security_pattern jsonb not null default '[]'::jsonb,
  notes text,
  work_detail text,
  checkout_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_repairs_owner on public.repairs(owner_id);
create index if not exists idx_repairs_tracking_code on public.repairs(tracking_code);

-- 4. Tickets públicos para seguimiento sin login
create table if not exists public.public_tickets (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  repair_id text not null,
  tracking_code text not null,
  repair_code text not null,
  business_name text not null,
  business_phone text,
  device_type text not null,
  brand text not null,
  model text not null,
  status text not null,
  progress integer not null default 15,
  date_in text not null,
  date_est text,
  problem_summary text not null,
  work_detail text,
  price numeric not null default 0,
  deposit numeric not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_public_tickets_owner on public.public_tickets(owner_id);
create index if not exists idx_public_tickets_tracking_code on public.public_tickets(tracking_code);

-- 5. Productos, repuestos e inventario
create table if not exists public.products (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  meta_description text,
  product_type text not null default 'Fisico',
  image_data_url text,
  category text not null default 'Repuesto',
  subcategory text,
  brand text,
  supplier_id text,
  supplier_name text,
  sku text,
  barcode text,
  location text,
  internal_code text,
  cost numeric not null default 0,
  margin_mode text not null default 'percent',
  margin numeric not null default 0,
  vat numeric not null default 0,
  rounding numeric not null default 0,
  net_price numeric not null default 0,
  price numeric not null default 0,
  track_stock boolean not null default true,
  allow_no_stock boolean not null default false,
  uses_serial boolean not null default false,
  stock integer not null default 0,
  min_stock integer not null default 1,
  reorder_cap integer,
  weight numeric,
  height numeric,
  width numeric,
  depth numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_products_owner on public.products(owner_id);

-- 6. Agenda / Tareas
create table if not exists public.tasks (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  task_type text not null default 'seguimiento',
  priority text not null default 'media',
  assignee text,
  due_date text,
  status text not null default 'pendiente',
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_tasks_owner on public.tasks(owner_id);

-- 7. Proveedores
create table if not exists public.suppliers (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'Repuestos',
  contact text,
  phone text,
  email text,
  lead_time text,
  balance numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_suppliers_owner on public.suppliers(owner_id);

-- 8. Ventas
create table if not exists public.sales (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id text,
  client_name text not null,
  invoice text not null,
  product_id text,
  product_name text,
  quantity integer,
  amount numeric not null default 0,
  status text not null default 'cobrado',
  due_date text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_owner on public.sales(owner_id);

-- 9. Compras a proveedores
create table if not exists public.purchases (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  supplier_id text,
  supplier_name text not null,
  invoice text not null,
  amount numeric not null default 0,
  status text not null default 'pendiente',
  due_date text,
  created_at timestamptz not null default now()
);

create index if not exists idx_purchases_owner on public.purchases(owner_id);

-- Row Level Security (RLS)
alter table public.workshop_profiles enable row level security;
alter table public.clients enable row level security;
alter table public.repairs enable row level security;
alter table public.public_tickets enable row level security;
alter table public.products enable row level security;
alter table public.tasks enable row level security;
alter table public.suppliers enable row level security;
alter table public.sales enable row level security;
alter table public.purchases enable row level security;

-- Políticas por dueño autenticado
drop policy if exists "workshop_profiles_owner_all" on public.workshop_profiles;
create policy "workshop_profiles_owner_all" on public.workshop_profiles
  for all to authenticated
  using (auth.uid() = owner_id and id = auth.uid()::text)
  with check (auth.uid() = owner_id and id = auth.uid()::text);

drop policy if exists "clients_owner_all" on public.clients;
create policy "clients_owner_all" on public.clients
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "repairs_owner_all" on public.repairs;
create policy "repairs_owner_all" on public.repairs
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "products_owner_all" on public.products;
create policy "products_owner_all" on public.products
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "tasks_owner_all" on public.tasks;
create policy "tasks_owner_all" on public.tasks
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "suppliers_owner_all" on public.suppliers;
create policy "suppliers_owner_all" on public.suppliers
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "sales_owner_all" on public.sales;
create policy "sales_owner_all" on public.sales
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "purchases_owner_all" on public.purchases;
create policy "purchases_owner_all" on public.purchases
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Public tickets: evitar listado masivo por otros talleres/anónimos; lectura directa solo al dueño
-- y consulta pública puntual únicamente por código exacto vía función RPC.
drop policy if exists "public_tickets_public_read" on public.public_tickets;
drop policy if exists "public_tickets_owner_read" on public.public_tickets;
create policy "public_tickets_owner_read" on public.public_tickets
  for select to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "public_tickets_owner_write" on public.public_tickets;
create policy "public_tickets_owner_write" on public.public_tickets
  for insert to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "public_tickets_owner_update" on public.public_tickets;
create policy "public_tickets_owner_update" on public.public_tickets
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "public_tickets_owner_delete" on public.public_tickets;
create policy "public_tickets_owner_delete" on public.public_tickets
  for delete to authenticated
  using (auth.uid() = owner_id);

revoke all on table
  public.workshop_profiles,
  public.clients,
  public.repairs,
  public.public_tickets,
  public.products,
  public.tasks,
  public.suppliers,
  public.sales,
  public.purchases
from anon, public;

grant select, insert, update, delete on table
  public.workshop_profiles,
  public.clients,
  public.repairs,
  public.public_tickets,
  public.products,
  public.tasks,
  public.suppliers,
  public.sales,
  public.purchases
to authenticated;

drop function if exists public.get_public_ticket_by_code(text);
create function public.get_public_ticket_by_code(p_tracking_code text)
returns table (
  id text,
  repair_id text,
  tracking_code text,
  repair_code text,
  business_name text,
  business_phone text,
  device_type text,
  brand text,
  model text,
  status text,
  progress integer,
  date_in text,
  date_est text,
  problem_summary text,
  work_detail text,
  price numeric,
  deposit numeric,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.id,
    t.repair_id,
    t.tracking_code,
    t.repair_code,
    t.business_name,
    t.business_phone,
    t.device_type,
    t.brand,
    t.model,
    t.status,
    t.progress,
    t.date_in,
    t.date_est,
    t.problem_summary,
    t.work_detail,
    t.price,
    t.deposit,
    t.updated_at
  from public.public_tickets t
  where p_tracking_code is not null
    and upper(trim(p_tracking_code)) ~ '^[A-Z0-9_-]{1,40}$'
    and t.id = upper(trim(p_tracking_code))
  limit 1;
$$;

revoke all on function public.get_public_ticket_by_code(text) from public;
grant execute on function public.get_public_ticket_by_code(text) to anon, authenticated;

-- Validaciones de integridad a nivel base de datos (idempotente)
alter table public.repairs
  drop constraint if exists chk_repairs_non_negative;
alter table public.repairs
  add constraint chk_repairs_non_negative
  check (price >= 0 and deposit >= 0 and paid_amount >= 0 and progress between 0 and 100) not valid;

alter table public.products
  drop constraint if exists chk_products_non_negative;
alter table public.products
  add constraint chk_products_non_negative
  check (cost >= 0 and vat >= 0 and price >= 0 and stock >= 0 and min_stock >= 0) not valid;

alter table public.sales
  drop constraint if exists chk_sales_non_negative;
alter table public.sales
  add constraint chk_sales_non_negative
  check (amount >= 0 and (quantity is null or quantity > 0)) not valid;

alter table public.purchases
  drop constraint if exists chk_purchases_non_negative;
alter table public.purchases
  add constraint chk_purchases_non_negative
  check (amount >= 0) not valid;

-- Nota sobre Realtime (opcional para sincronización entre múltiples dispositivos):
-- En Supabase Dashboard -> Database -> Publications -> supabase_realtime,
-- podés activar las tablas de arriba con un clic si usás varios dispositivos a la vez.
