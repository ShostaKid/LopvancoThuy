-- 003_classes_students.sql — Bước 3: Lớp & khóa, Học sinh (SPEC.md mục 7 A3, A4)

-- Đặt khóa hiện tại. Làm trong 1 hàm để không lúc nào có 2 khóa hiện tại hoặc không có khóa nào.
create or replace function public.set_current_term(p_term_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.terms where id = p_term_id) then
    raise exception 'Không tìm thấy khóa học.';
  end if;
  update public.terms set is_current = false where is_current and id <> p_term_id;
  update public.terms set is_current = true where id = p_term_id;
end;
$$;

-- Nhập hàng loạt vào 1 lớp: mỗi phần tử là {"full_name": "..."} (tạo em mới)
-- hoặc {"student_id": "..."} (em đã có). Chạy trọn trong 1 giao dịch: lỗi ở đâu thì không em nào được thêm.
-- Mã HS sinh theo đúng thứ tự trong danh sách. Em đã nghỉ lớp đó thì được ghi danh lại.
-- SECURITY INVOKER (mặc định) nên vẫn đi qua RLS như khi thêm tay.
create or replace function public.bulk_add_students(p_class_id uuid, p_term_id uuid, p_items jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_student_id uuid;
  v_codes text[] := '{}';
  v_code text;
  v_enrolled int := 0;
begin
  for v_item in
    select e from jsonb_array_elements(p_items) with ordinality as t(e, i) order by i
  loop
    if v_item ? 'student_id' then
      v_student_id := (v_item ->> 'student_id')::uuid;
    else
      insert into public.students (full_name)
      values (v_item ->> 'full_name')
      returning id, code into v_student_id, v_code;
      v_codes := v_codes || v_code;
    end if;

    insert into public.enrollments (student_id, class_id, term_id)
    values (v_student_id, p_class_id, p_term_id)
    on conflict (student_id, class_id, term_id) do update set left_on = null;
    v_enrolled := v_enrolled + 1;
  end loop;

  return jsonb_build_object('created_codes', to_jsonb(v_codes), 'enrolled', v_enrolled);
end;
$$;

revoke execute on function public.set_current_term(uuid), public.bulk_add_students(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_current_term(uuid), public.bulk_add_students(uuid, uuid, jsonb) to authenticated;
