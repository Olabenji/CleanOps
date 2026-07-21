-- Resolve the ambiguous PL/pgSQL status reference reported by plpgsql_check.

create or replace function public.update_compliance_case_status(
  input_case_id uuid,
  next_status text,
  input_closure_notes text default null
)
returns void
language plpgsql
security invoker
as $$
declare
  normalized_status text := lower(trim(next_status));
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Not allowed to update compliance cases';
  end if;

  if normalized_status not in ('open', 'investigating', 'closed', 'referred') then
    raise exception 'Invalid compliance status';
  end if;

  update public.compliance_cases as compliance_case
  set
    status = normalized_status,
    closed_at = case
      when normalized_status = 'closed' then coalesce(compliance_case.closed_at, now())
      else null
    end,
    closure_notes = coalesce(
      nullif(trim(coalesce(input_closure_notes, '')), ''),
      compliance_case.closure_notes
    )
  where compliance_case.id = input_case_id
    and compliance_case.operator_id = public.current_operator_id();

  if not found then
    raise exception 'Compliance case not found';
  end if;
end;
$$;

grant execute on function public.update_compliance_case_status(uuid, text, text) to authenticated;
