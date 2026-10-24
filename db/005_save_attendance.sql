-- 005_save_attendance.sql — Bước 4: lưu điểm danh (SPEC.md mục 7 A2)
-- "Lưu = tạo session nếu chưa có + upsert attendance" trong 1 giao dịch: lỗi ở đâu thì không dòng nào được lưu.
-- SECURITY INVOKER (mặc định): vẫn đi qua RLS (phải có trong staff) và trigger khóa tháng đã chốt.
-- p_records: [{"student_id": "...", "present": true|false}, ...]

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

  insert into public.attendance (session_id, student_id, present)
  select v_session, (r ->> 'student_id')::uuid, (r ->> 'present')::boolean
  from jsonb_array_elements(p_records) r
  on conflict (session_id, student_id) do update set present = excluded.present;
  get diagnostics v_saved = row_count;

  return jsonb_build_object('session_id', v_session, 'saved', v_saved);
end;
$$;

revoke execute on function public.save_attendance(uuid, date, jsonb) from public, anon;
grant execute on function public.save_attendance(uuid, date, jsonb) to authenticated;
