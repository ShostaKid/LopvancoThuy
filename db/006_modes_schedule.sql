-- 006_modes_schedule.sql — Bước 5 (bổ sung): hình thức học onl/off theo từng em, khóa điểm danh ngày không có tiết

-- Hình thức học mặc định của từng em (đổi được ở màn hình Học sinh)
alter table public.students
  add column mode text not null default 'offline' check (mode in ('online', 'offline'));

-- Hình thức học thực tế của em trong buổi đó (em offline có hôm học online vì lý do bất khả kháng)
alter table public.attendance
  add column mode text not null default 'offline' check (mode in ('online', 'offline'));

-- Chỉ tạo/đổi buổi học vào đúng thứ có tiết của lớp (classes.weekdays; 2 = Thứ 2 … 8 = CN).
-- Chỉ kiểm tra khi thêm buổi hoặc đổi ngày/lớp, để sau này đổi lịch lớp không làm kẹt buổi cũ.
create or replace function public.sessions_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
  v_days smallint[];
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
    if tg_op = 'INSERT' or new.class_id is distinct from old.class_id or new.date is distinct from old.date then
      select name, weekdays into v_name, v_days from public.classes where id = new.class_id;
      if v_name is null then
        raise exception 'Không tìm thấy lớp.';
      end if;
      if not (extract(isodow from new.date)::int + 1) = any (v_days) then
        raise exception '% không có tiết vào ngày %.', v_name, to_char(new.date, 'DD/MM/YYYY');
      end if;
    end if;
    return new;
  end if;
  return old;
end;
$$;

-- Lưu điểm danh: thêm hình thức học từng em. Không gửi mode thì lấy mặc định của em.
-- p_records: [{"student_id": "...", "present": true|false, "mode": "online"|"offline"}, ...]
create or replace function public.save_attendance(p_class_id uuid, p_date date, p_records jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_session uuid;
  v_saved int;
begin
  if p_date > public.vn_today() then
    raise exception 'Không điểm danh trước cho ngày chưa tới.';
  end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) = 0 then
    raise exception 'Danh sách điểm danh trống.';
  end if;

  select id into v_session from public.sessions where class_id = p_class_id and date = p_date;
  if v_session is null then
    insert into public.sessions (class_id, date) values (p_class_id, p_date) returning id into v_session;
  end if;

  insert into public.attendance (session_id, student_id, present, mode)
  select v_session, (r ->> 'student_id')::uuid, (r ->> 'present')::boolean, coalesce(r ->> 'mode', s.mode)
  from jsonb_array_elements(p_records) r
  left join public.students s on s.id = (r ->> 'student_id')::uuid
  on conflict (session_id, student_id) do update set present = excluded.present, mode = excluded.mode;
  get diagnostics v_saved = row_count;

  return jsonb_build_object('session_id', v_session, 'saved', v_saved);
end;
$$;
