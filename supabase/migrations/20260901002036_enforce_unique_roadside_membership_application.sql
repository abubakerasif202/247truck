alter table public.roadside_memberships
  add constraint roadside_memberships_application_id_key unique (application_id);
