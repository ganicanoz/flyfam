-- Track installed app/device metadata for admin dashboard user list.
alter table public.device_tokens
  add column if not exists app_version text,
  add column if not exists app_build text,
  add column if not exists os_version text;

comment on column public.device_tokens.app_version is 'Installed app semantic version (e.g. 1.3.2).';
comment on column public.device_tokens.app_build is 'Build number / runtime version string.';
comment on column public.device_tokens.os_version is 'Mobile OS version from device.';
