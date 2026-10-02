// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type CrewRoomAdminCtx = {
  adminClient: AdminClient;
  requesterEmail: string;
  corsHeaders: Record<string, string>;
};

export const CREW_ROOM_ADMIN_ACTIONS = new Set([
  'crew_room_admin_overview',
  'crew_room_admin_update_prefs',
  'crew_room_admin_set_share',
  'crew_room_admin_set_link_status',
  'crew_room_admin_create_link',
  'crew_room_admin_preview',
]);

const LEVELS = new Set(['hidden', 'availability', 'destination', 'full']);
const LINK_STATUSES = new Set(['pending', 'approved', 'declined', 'removed']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function uuid(v: unknown, field: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!UUID_RE.test(s)) throw new HttpError(400, `${field} must be a uuid`);
  return s;
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new HttpError(500, `${what}: ${res.error.message}`);
  return res.data;
}

type CrewInfo = {
  crew_id: string;
  user_id: string | null;
  name: string | null;
  email: string | null;
  airline_icao: string | null;
  home_base: string | null;
};

async function loadEmails(ctx: CrewRoomAdminCtx): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await ctx.adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    const users = Array.isArray(data?.users) ? data.users : [];
    for (const u of users) if (u?.id && u?.email) out.set(String(u.id), String(u.email).toLowerCase());
    if (users.length < 1000) break;
  }
  return out;
}

async function loadCrewDirectory(ctx: CrewRoomAdminCtx): Promise<Map<string, CrewInfo>> {
  const crew = must(
    await ctx.adminClient.from('crew_profiles').select('id, user_id, airline_icao, home_base_iata').limit(5000),
    'crew_profiles',
  ) as Array<{ id: string; user_id: string | null; airline_icao: string | null; home_base_iata: string | null }>;
  const userIds = crew.map((c) => c.user_id).filter((x): x is string => !!x);
  const names = new Map<string, string | null>();
  for (let i = 0; i < userIds.length; i += 500) {
    const rows = must(
      await ctx.adminClient.from('profiles').select('id, full_name').in('id', userIds.slice(i, i + 500)),
      'profiles',
    ) as Array<{ id: string; full_name: string | null }>;
    for (const r of rows) names.set(r.id, r.full_name);
  }
  const emails = await loadEmails(ctx);
  const dir = new Map<string, CrewInfo>();
  for (const c of crew) {
    dir.set(c.id, {
      crew_id: c.id,
      user_id: c.user_id,
      name: c.user_id ? names.get(c.user_id) ?? null : null,
      email: c.user_id ? emails.get(c.user_id) ?? null : null,
      airline_icao: c.airline_icao,
      home_base: c.home_base_iata,
    });
  }
  return dir;
}

async function rpcText(ctx: CrewRoomAdminCtx, fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await ctx.adminClient.rpc(fn, args);
  if (error) return null;
  return typeof data === 'string' ? data : data == null ? null : String(data);
}

async function overview(ctx: CrewRoomAdminCtx) {
  const db = ctx.adminClient;
  const [prefs, links, shares, notified, dir] = await Promise.all([
    db.from('crew_room_prefs').select('crew_id, default_level, invisible, notify_layover, created_at, updated_at').then((r: never) => must(r, 'crew_room_prefs')),
    db.from('crew_room_links').select('id, requester_crew_id, addressee_crew_id, status, created_at, responded_at, updated_at').order('created_at', { ascending: false }).then((r: never) => must(r, 'crew_room_links')),
    db.from('crew_room_shares').select('owner_crew_id, viewer_crew_id, level, updated_at').then((r: never) => must(r, 'crew_room_shares')),
    db.from('crew_room_notified').select('viewer_crew_id, other_crew_id, day, created_at').order('created_at', { ascending: false }).limit(200).then((r: never) => must(r, 'crew_room_notified')),
    loadCrewDirectory(ctx),
  ]) as [
    Array<{ crew_id: string; default_level: string; invisible: boolean; notify_layover: boolean; created_at: string; updated_at: string }>,
    Array<{ id: string; requester_crew_id: string; addressee_crew_id: string; status: string; created_at: string; responded_at: string | null; updated_at: string }>,
    Array<{ owner_crew_id: string; viewer_crew_id: string; level: string; updated_at: string }>,
    Array<{ viewer_crew_id: string; other_crew_id: string; day: string; created_at: string }>,
    Map<string, CrewInfo>,
  ];

  const prefsBy = new Map(prefs.map((p) => [p.crew_id, p]));
  const shareKey = (o: string, v: string) => o + '>' + v;
  const shareBy = new Map(shares.map((s) => [shareKey(s.owner_crew_id, s.viewer_crew_id), s]));
  const ids = new Set<string>(prefs.map((p) => p.crew_id));
  for (const l of links) {
    ids.add(l.requester_crew_id);
    ids.add(l.addressee_crew_id);
  }

  const access = new Map<string, boolean>();
  await Promise.all([...ids].map(async (id) => {
    const { data } = await db.rpc('crew_has_active_subscription', { p_crew_id: id });
    access.set(id, data === true);
  }));

  const brief = (id: string) => {
    const c = dir.get(id);
    return { crew_id: id, name: c?.name ?? null, email: c?.email ?? null, airline_icao: c?.airline_icao ?? null };
  };

  const linkRows = await Promise.all(links.map(async (l) => {
    const a = l.requester_crew_id, b = l.addressee_crew_id;
    const approved = l.status === 'approved';
    const [ab, ba] = approved
      ? await Promise.all([
        rpcText(ctx, 'crew_room_effective_level', { p_owner: a, p_viewer: b }),
        rpcText(ctx, 'crew_room_effective_level', { p_owner: b, p_viewer: a }),
      ])
      : ['hidden', 'hidden'];
    return {
      id: l.id,
      status: l.status,
      created_at: l.created_at,
      responded_at: l.responded_at,
      updated_at: l.updated_at,
      requester: brief(a),
      addressee: brief(b),
      level_ab: ab,
      level_ba: ba,
      override_ab: shareBy.get(shareKey(a, b))?.level ?? null,
      override_ba: shareBy.get(shareKey(b, a))?.level ?? null,
    };
  }));

  const people = [...ids].map((id) => {
    const c = dir.get(id);
    const p = prefsBy.get(id);
    const mine = links.filter((l) => l.requester_crew_id === id || l.addressee_crew_id === id);
    return {
      crew_id: id,
      user_id: c?.user_id ?? null,
      name: c?.name ?? null,
      email: c?.email ?? null,
      airline_icao: c?.airline_icao ?? null,
      home_base: c?.home_base ?? null,
      has_access: access.get(id) === true,
      has_prefs: !!p,
      default_level: p?.default_level ?? 'availability',
      invisible: p?.invisible ?? false,
      notify_layover: p?.notify_layover ?? false,
      prefs_updated_at: p?.updated_at ?? null,
      contacts: mine.filter((l) => l.status === 'approved').length,
      pending_in: mine.filter((l) => l.status === 'pending' && l.addressee_crew_id === id).length,
      pending_out: mine.filter((l) => l.status === 'pending' && l.requester_crew_id === id).length,
      overrides_out: shares.filter((s) => s.owner_crew_id === id).length,
    };
  }).sort((x, y) => String(x.name || x.email || '').localeCompare(String(y.name || y.email || ''), 'tr'));

  const byStatus = (s: string) => links.filter((l) => l.status === s).length;
  const weekAgo = Date.now() - 7 * 86400000;
  const levels: Record<string, number> = { hidden: 0, availability: 0, destination: 0, full: 0 };
  for (const p of prefs) levels[p.default_level] = (levels[p.default_level] ?? 0) + 1;

  const crewOptions = [...dir.values()]
    .filter((c) => c.user_id)
    .map((c) => ({ crew_id: c.crew_id, name: c.name, email: c.email, airline_icao: c.airline_icao }))
    .sort((x, y) => String(x.name || x.email || '').localeCompare(String(y.name || y.email || ''), 'tr'));

  return {
    generated_at: new Date().toISOString(),
    stats: {
      people: people.length,
      with_prefs: prefs.length,
      with_access: people.filter((p) => p.has_access).length,
      approved: byStatus('approved'),
      pending: byStatus('pending'),
      declined: byStatus('declined'),
      removed: byStatus('removed'),
      overrides: shares.length,
      invisible: prefs.filter((p) => p.invisible).length,
      notify_layover: prefs.filter((p) => p.notify_layover).length,
      notified_total: notified.length,
      notified_7d: notified.filter((n) => Date.parse(n.created_at) >= weekAgo).length,
      default_levels: levels,
    },
    people,
    links: linkRows,
    notified: notified.map((n) => ({
      viewer: brief(n.viewer_crew_id),
      other: brief(n.other_crew_id),
      day: n.day,
      created_at: n.created_at,
    })),
    crew_options: crewOptions,
  };
}

async function requireCrew(ctx: CrewRoomAdminCtx, id: string) {
  const row = must(await ctx.adminClient.from('crew_profiles').select('id').eq('id', id).maybeSingle(), 'crew_profiles');
  if (!row) throw new HttpError(404, 'crew profile not found');
}

async function findLink(ctx: CrewRoomAdminCtx, a: string, b: string) {
  const rows = must(
    await ctx.adminClient
      .from('crew_room_links')
      .select('id, requester_crew_id, addressee_crew_id, status')
      .or(`and(requester_crew_id.eq.${a},addressee_crew_id.eq.${b}),and(requester_crew_id.eq.${b},addressee_crew_id.eq.${a})`)
      .limit(1),
    'crew_room_links',
  ) as Array<{ id: string; requester_crew_id: string; addressee_crew_id: string; status: string }>;
  return rows[0] ?? null;
}

async function ensurePrefs(ctx: CrewRoomAdminCtx, ids: string[]) {
  const res = await ctx.adminClient
    .from('crew_room_prefs')
    .upsert(ids.map((crew_id) => ({ crew_id })), { onConflict: 'crew_id', ignoreDuplicates: true });
  if (res.error) throw new HttpError(500, `crew_room_prefs: ${res.error.message}`);
}

async function clearPairShares(ctx: CrewRoomAdminCtx, a: string, b: string) {
  const res = await ctx.adminClient
    .from('crew_room_shares')
    .delete()
    .or(`and(owner_crew_id.eq.${a},viewer_crew_id.eq.${b}),and(owner_crew_id.eq.${b},viewer_crew_id.eq.${a})`);
  if (res.error) throw new HttpError(500, `crew_room_shares: ${res.error.message}`);
}

function audit(ctx: CrewRoomAdminCtx, action: string, detail: Record<string, unknown>) {
  console.log('[admin-dashboard] crew room admin change', JSON.stringify({ action, by: ctx.requesterEmail, ...detail }));
}

export async function handleCrewRoomAdminAction(
  action: string,
  body: Record<string, unknown> | null,
  ctx: CrewRoomAdminCtx,
): Promise<Response> {
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...ctx.corsHeaders, 'Content-Type': 'application/json' } });
  try {
    if (action === 'crew_room_admin_overview') {
      return json({ ok: true, action, ...(await overview(ctx)) });
    }

    if (action === 'crew_room_admin_update_prefs') {
      const crewId = uuid(body?.crew_id, 'crew_id');
      await requireCrew(ctx, crewId);
      const patch: Record<string, unknown> = {};
      if (body?.default_level !== undefined) {
        const lvl = String(body.default_level);
        if (!LEVELS.has(lvl)) throw new HttpError(400, 'invalid default_level');
        patch.default_level = lvl;
      }
      if (body?.invisible !== undefined) {
        if (typeof body.invisible !== 'boolean') throw new HttpError(400, 'invisible must be boolean');
        patch.invisible = body.invisible;
      }
      if (body?.notify_layover !== undefined) {
        if (typeof body.notify_layover !== 'boolean') throw new HttpError(400, 'notify_layover must be boolean');
        patch.notify_layover = body.notify_layover;
      }
      if (!Object.keys(patch).length) throw new HttpError(400, 'nothing to update');
      await ensurePrefs(ctx, [crewId]);
      const row = must(
        await ctx.adminClient
          .from('crew_room_prefs')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('crew_id', crewId)
          .select('crew_id, default_level, invisible, notify_layover, updated_at')
          .single(),
        'crew_room_prefs',
      );
      audit(ctx, action, { crew_id: crewId, patch });
      return json({ ok: true, action, prefs: row });
    }

    if (action === 'crew_room_admin_set_share') {
      const owner = uuid(body?.owner_crew_id, 'owner_crew_id');
      const viewer = uuid(body?.viewer_crew_id, 'viewer_crew_id');
      if (owner === viewer) throw new HttpError(400, 'owner and viewer must differ');
      const level = body?.level == null || body.level === '' ? null : String(body.level);
      if (level !== null && !LEVELS.has(level)) throw new HttpError(400, 'invalid level');
      const link = await findLink(ctx, owner, viewer);
      if (!link || link.status !== 'approved') throw new HttpError(409, 'not_connected');
      if (level === null) {
        const res = await ctx.adminClient.from('crew_room_shares').delete().eq('owner_crew_id', owner).eq('viewer_crew_id', viewer);
        if (res.error) throw new HttpError(500, `crew_room_shares: ${res.error.message}`);
      } else {
        const res = await ctx.adminClient
          .from('crew_room_shares')
          .upsert({ owner_crew_id: owner, viewer_crew_id: viewer, level, updated_at: new Date().toISOString() }, { onConflict: 'owner_crew_id,viewer_crew_id' });
        if (res.error) throw new HttpError(500, `crew_room_shares: ${res.error.message}`);
      }
      const effective = await rpcText(ctx, 'crew_room_effective_level', { p_owner: owner, p_viewer: viewer });
      audit(ctx, action, { owner, viewer, level });
      return json({ ok: true, action, level, effective });
    }

    if (action === 'crew_room_admin_set_link_status') {
      const linkId = uuid(body?.link_id, 'link_id');
      const status = String(body?.status ?? '');
      if (!LINK_STATUSES.has(status) || status === 'pending') throw new HttpError(400, 'status must be approved, declined or removed');
      const link = must(
        await ctx.adminClient.from('crew_room_links').select('id, requester_crew_id, addressee_crew_id, status').eq('id', linkId).maybeSingle(),
        'crew_room_links',
      ) as { id: string; requester_crew_id: string; addressee_crew_id: string; status: string } | null;
      if (!link) throw new HttpError(404, 'link not found');
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { status, updated_at: now };
      if (status !== 'removed') patch.responded_at = now;
      const res = await ctx.adminClient.from('crew_room_links').update(patch).eq('id', linkId);
      if (res.error) throw new HttpError(500, `crew_room_links: ${res.error.message}`);
      if (status !== 'approved') await clearPairShares(ctx, link.requester_crew_id, link.addressee_crew_id);
      else await ensurePrefs(ctx, [link.requester_crew_id, link.addressee_crew_id]);
      audit(ctx, action, { link_id: linkId, from: link.status, to: status });
      return json({ ok: true, action, link_id: linkId, status });
    }

    if (action === 'crew_room_admin_create_link') {
      const a = uuid(body?.requester_crew_id, 'requester_crew_id');
      const b = uuid(body?.addressee_crew_id, 'addressee_crew_id');
      if (a === b) throw new HttpError(400, 'cannot link a crew member to themselves');
      const status = String(body?.status ?? 'pending');
      if (status !== 'pending' && status !== 'approved') throw new HttpError(400, 'status must be pending or approved');
      await requireCrew(ctx, a);
      await requireCrew(ctx, b);
      const now = new Date().toISOString();
      const existing = await findLink(ctx, a, b);
      let linkId: string;
      if (existing) {
        if (existing.status === 'approved') return json({ ok: true, action, link_id: existing.id, status: 'approved', result: 'already_connected' });
        const res = await ctx.adminClient
          .from('crew_room_links')
          .update({
            requester_crew_id: a,
            addressee_crew_id: b,
            status,
            created_at: now,
            responded_at: status === 'approved' ? now : null,
            updated_at: now,
          })
          .eq('id', existing.id);
        if (res.error) throw new HttpError(500, `crew_room_links: ${res.error.message}`);
        linkId = existing.id;
      } else {
        const row = must(
          await ctx.adminClient
            .from('crew_room_links')
            .insert({ requester_crew_id: a, addressee_crew_id: b, status, responded_at: status === 'approved' ? now : null })
            .select('id')
            .single(),
          'crew_room_links',
        ) as { id: string };
        linkId = row.id;
      }
      await ensurePrefs(ctx, [a, b]);
      audit(ctx, action, { link_id: linkId, requester: a, addressee: b, status });
      return json({ ok: true, action, link_id: linkId, status, result: existing ? 'updated' : 'created' });
    }

    if (action === 'crew_room_admin_preview') {
      const viewer = uuid(body?.viewer_crew_id, 'viewer_crew_id');
      const daysRaw = Number(body?.days ?? 14);
      const days = Number.isFinite(daysRaw) ? Math.min(62, Math.max(1, Math.floor(daysRaw))) : 14;
      const fromRaw = typeof body?.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : new Date().toISOString().slice(0, 10);
      const to = new Date(Date.parse(fromRaw + 'T00:00:00Z') + (days - 1) * 86400000).toISOString().slice(0, 10);
      const rows = must(
        await ctx.adminClient.rpc('crew_room_days_for', { p_viewer: viewer, p_from: fromRaw, p_to: to }),
        'crew_room_days_for',
      ) as Array<Record<string, unknown>>;
      const ids = [...new Set((rows ?? []).map((r) => String(r.crew_id)))];
      const dir = new Map<string, CrewInfo>();
      if (ids.length) {
        const crew = must(
          await ctx.adminClient.from('crew_profiles').select('id, user_id, airline_icao, home_base_iata').in('id', ids),
          'crew_profiles',
        ) as Array<{ id: string; user_id: string | null; airline_icao: string | null; home_base_iata: string | null }>;
        const uids = crew.map((c) => c.user_id).filter((x): x is string => !!x);
        const names = uids.length
          ? (must(await ctx.adminClient.from('profiles').select('id, full_name').in('id', uids), 'profiles') as Array<{ id: string; full_name: string | null }>)
          : [];
        const nameBy = new Map(names.map((n) => [n.id, n.full_name]));
        for (const c of crew) {
          dir.set(c.id, { crew_id: c.id, user_id: c.user_id, name: c.user_id ? nameBy.get(c.user_id) ?? null : null, email: null, airline_icao: c.airline_icao, home_base: c.home_base_iata });
        }
      }
      return json({
        ok: true,
        action,
        viewer_crew_id: viewer,
        from: fromRaw,
        to,
        people: ids.map((id) => ({
          crew_id: id,
          name: dir.get(id)?.name ?? null,
          home_base: dir.get(id)?.home_base ?? null,
          is_viewer: id === viewer,
        })),
        days: rows ?? [],
      });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('[admin-dashboard] crew room admin action failed', action, e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
