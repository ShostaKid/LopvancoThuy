-- 001_init.sql — Bước 1: database (SPEC.md mục 4, 5, 6.1, 6.3)
-- Chạy một lần trên project Supabase mới.

create extension if not exists unaccent with schema extensions;

-- ===================== Hàm tiện ích =====================

-- Ngày hôm nay theo giờ Việt Nam
create or replace function public.vn_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date
$$;

-- Chuẩn hóa tên (SPEC 6.1), dùng chung cho trigger học sinh và lookup_student.
-- NFC trước để chữ gõ kiểu "Unicode tổ hợp" cũng bỏ dấu được.
-- unaccent phải dùng dạng 2 tham số vì search_path rỗng thì dạng 1 tham số không thấy từ điển.
-- chr(160) là dấu cách không ngắt (hay gặp khi copy từ Zalo/Word).
create or replace function public.normalize_name(p_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select btrim(regexp_replace(
    translate(
      lower(extensions.unaccent('extensions.unaccent'::regdictionary,
                                normalize(coalesce(p_name, ''), NFC))),
      'đĐ' || chr(160), 'dd '),
    '\s+', ' ', 'g'))
$$;

-- Mã học sinh HS001, HS002… Quá 999 thì dài thêm số, không bị cắt.
create sequence public.student_code_seq;

create or replace function public.next_student_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'HS' || lpad(n::text, greatest(3, length(n::text)), '0')
  from (select nextval('public.student_code_seq') as n) s
$$;

-- ===================== Bảng =====================

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_date > start_date)
);
-- Chỉ 1 khóa is_current = true
create unique index terms_one_current on public.terms (is_current) where is_current;

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  grade smallint not null check (grade between 8 and 12),
  mode text not null check (mode in ('online', 'offline')),
  weekdays smallint[] not null default '{}' check (weekdays <@ '{2,3,4,5,6,7,8}'::smallint[]), -- 2 = Thứ 2 … 8 = CN
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.next_student_code(),
  full_name text not null check (full_name <> ''),
  name_search text not null default '',
  dob date,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);
create index students_name_search_idx on public.students (name_search);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete restrict,
  term_id uuid not null references public.terms (id) on delete restrict,
  joined_on date not null default public.vn_today(),
  left_on date,
  created_at timestamptz not null default now(),
  unique (student_id, class_id, term_id),
  check (left_on is null or left_on >= joined_on)
);
create index enrollments_class_term_idx on public.enrollments (class_id, term_id);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  bank_bin text not null default '',
  account_no text not null default '',
  account_name text not null default '',
  default_fee integer not null default 200000 check (default_fee >= 0),
  created_at timestamptz not null default now()
);
-- Chỉ được có 1 dòng
create unique index settings_singleton on public.settings ((true));

-- Giá mặc định lấy từ settings, để đổi giá trong trang Cài đặt là buổi mới ăn theo
create or replace function public.get_default_fee()
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce((select default_fee from public.settings limit 1), 200000)
$$;

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete restrict,
  date date not null,
  fee integer not null default public.get_default_fee() check (fee >= 0),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (class_id, date)
);
create index sessions_date_idx on public.sessions (date);

create table public.attendance (
  session_id uuid not null references public.sessions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete restrict,
  present boolean not null default true,
  marked_by uuid default auth.uid() references auth.users (id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (session_id, student_id)
);
create index attendance_student_idx on public.attendance (student_id);

create table public.month_closings (
  id uuid primary key default gen_random_uuid(),
  month text not null unique check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  closed_at timestamptz not null default now(),
  closed_by uuid default auth.uid() references auth.users (id) on delete set null
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  sessions_count integer not null check (sessions_count >= 0),
  amount integer not null check (amount >= 0),
  transfer_note text not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'reported', 'confirmed')),
  reported_at timestamptz,
  reported_amount integer,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (student_id, month)
);
create index invoices_month_idx on public.invoices (month);

-- ===================== Trigger =====================

-- Học sinh: mã không được đổi, dọn khoảng trắng trong tên, cập nhật name_search
create or replace function public.students_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception 'Mã học sinh không được đổi (%).', old.code;
  end if;
  new.full_name := btrim(regexp_replace(translate(normalize(new.full_name, NFC), chr(160), ' '), '\s+', ' ', 'g'));
  new.name_search := public.normalize_name(new.full_name);
  return new;
end;
$$;

create trigger students_before_write
before insert or update on public.students
for each row execute function public.students_before_write();

-- Khóa sửa điểm danh tháng đã chốt (SPEC 6.3)
create or replace function public.is_month_closed(p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.month_closings where month = to_char(p_date, 'YYYY-MM'))
$$;

create or replace function public.sessions_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if public.is_month_closed(old.date) then
      raise exception 'Tháng % đã chốt. Mở lại tháng trước khi sửa buổi học.', to_char(old.date, 'MM/YYYY');
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if public.is_month_closed(new.date) then
      raise exception 'Tháng % đã chốt. Mở lại tháng trước khi thêm buổi học.', to_char(new.date, 'MM/YYYY');
    end if;
    return new;
  end if;
  return old;
end;
$$;

create trigger sessions_before_write
before insert or update or delete on public.sessions
for each row execute function public.sessions_before_write();

-- Điểm danh: chặn sửa tháng đã chốt, ghi lại ai sửa và lúc nào
create or replace function public.attendance_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_date date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select s.date into v_date from public.sessions s where s.id = old.session_id;
    if v_date is not null and public.is_month_closed(v_date) then
      raise exception 'Tháng % đã chốt. Mở lại tháng trước khi sửa điểm danh.', to_char(v_date, 'MM/YYYY');
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select s.date into v_date from public.sessions s where s.id = new.session_id;
    if v_date is not null and public.is_month_closed(v_date) then
      raise exception 'Tháng % đã chốt. Mở lại tháng trước khi sửa điểm danh.', to_char(v_date, 'MM/YYYY');
    end if;
    new.marked_at := now();
    new.marked_by := coalesce(auth.uid(), new.marked_by);
    return new;
  end if;
  return old;
end;
$$;

create trigger attendance_before_write
before insert or update or delete on public.attendance
for each row execute function public.attendance_before_write();

-- ===================== RPC cho phụ huynh (SPEC 5.1, 5.2) =====================

-- Tra cứu đúng họ tên đầy đủ. Trả về {students: [...], bank: {...}}.
-- Không lọc theo students.active: em đã nghỉ vẫn tra được để đóng nốt tháng cũ.
create or replace function public.lookup_student(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := public.normalize_name(p_name);
  v_latest text;
  v_students jsonb;
begin
  if coalesce(array_length(string_to_array(v_key, ' '), 1), 0) < 2 then
    return jsonb_build_object('students', '[]'::jsonb);
  end if;

  select max(month) into v_latest from public.month_closings;

  select coalesce(jsonb_agg(jsonb_build_object(
      'code', s.code,
      'full_name', s.full_name,
      'classes', coalesce((
        select jsonb_agg(c.name order by c.name)
        from public.enrollments e
        join public.classes c on c.id = e.class_id
        join public.terms t on t.id = e.term_id and t.is_current
        where e.student_id = s.id
          and (e.left_on is null or e.left_on >= public.vn_today())
      ), '[]'::jsonb),
      -- Tháng chốt gần nhất + mọi tháng cũ chưa confirmed; tháng đang mở lại thì ẩn
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
            'month', i.month,
            'sessions_count', i.sessions_count,
            'amount', i.amount,
            'status', i.status,
            'transfer_note', i.transfer_note,
            'present', coalesce((
              select jsonb_agg(jsonb_build_object('date', se.date, 'class', c2.name) order by se.date, c2.name)
              from public.attendance a
              join public.sessions se on se.id = a.session_id
              join public.classes c2 on c2.id = se.class_id
              where a.student_id = s.id
                and a.present
                and to_char(se.date, 'YYYY-MM') = i.month
            ), '[]'::jsonb)
          ) order by i.month desc)
        from public.invoices i
        join public.month_closings mc on mc.month = i.month
        where i.student_id = s.id
          and (i.month = v_latest or i.status <> 'confirmed')
      ), '[]'::jsonb)
    ) order by s.code), '[]'::jsonb)
  into v_students
  from public.students s
  where s.name_search = v_key;

  if v_students = '[]'::jsonb then
    return jsonb_build_object('students', v_students);
  end if;

  return jsonb_build_object(
    'students', v_students,
    'bank', (select jsonb_build_object('bank_bin', bank_bin, 'account_no', account_no, 'account_name', account_name)
             from public.settings limit 1));
end;
$$;

-- Phụ huynh báo đã chuyển khoản: chỉ unpaid → reported, chỉ với tháng đang chốt.
-- Trả về trạng thái sau khi gọi, hoặc null nếu không có hóa đơn.
create or replace function public.report_payment(p_code text, p_month text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.invoices i
     set status = 'reported',
         reported_at = now(),
         reported_amount = i.amount
    from public.students s
   where s.id = i.student_id
     and s.code = upper(btrim(p_code))
     and i.month = btrim(p_month)
     and i.status = 'unpaid'
     and exists (select 1 from public.month_closings mc where mc.month = i.month);

  select i.status into v_status
    from public.invoices i
    join public.students s on s.id = i.student_id
    join public.month_closings mc on mc.month = i.month
   where s.code = upper(btrim(p_code))
     and i.month = btrim(p_month);

  return v_status;
end;
$$;

-- ===================== RLS & quyền (SPEC 5) =====================

-- Admin (authenticated) toàn quyền; anon không có policy nào
do $$
declare
  t text;
begin
  foreach t in array array['terms', 'classes', 'students', 'enrollments', 'settings',
                           'sessions', 'attendance', 'month_closings', 'invoices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Thu hết quyền của anon, chỉ chừa 2 RPC tra cứu và báo chuyển khoản
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.lookup_student(text), public.report_payment(text, text) to anon;

-- Bảng/hàm tạo sau này cũng không tự cấp cho anon
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ===================== Dữ liệu ban đầu =====================

insert into public.terms (name, start_date, end_date, is_current)
values ('2026–2027', '2026-08-01', '2027-07-31', true);

-- Thông tin tài khoản nhận tiền điền sau trong trang Cài đặt (A7)
insert into public.settings (default_fee) values (200000);
