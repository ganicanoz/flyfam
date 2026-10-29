import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAdminRoster } from '../contexts/AdminRosterContext';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';

type AdminHealth = {
  phase_refresh?: {
    status?: string;
    healthy?: boolean;
    last_success_at?: string | null;
    last_run_at?: string | null;
    last_error?: string | null;
    last_rows_updated?: number | null;
  } | null;
};

type AdminUserRow = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  device_count?: number;
  device_platforms_text?: string | null;
};

type AdminDashboardResponse = {
  generated_at?: string;
  flights?: {
    total?: number;
    active_now?: number;
    phase_summary?: Record<string, number>;
  };
  health?: AdminHealth;
  users?: {
    rows?: AdminUserRow[];
  };
};

function fmt(iso: string | null | undefined): string {
  if (!iso) return '-';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return String(iso);
  return new Date(t).toLocaleString();
}

function userLabel(u: AdminUserRow): string {
  const name = (u.full_name || '').trim();
  const email = (u.email || '').trim();
  if (name && email) return `${name} (${email})`;
  return name || email || u.id.slice(0, 8);
}

export default function AdminPanel() {
  const { t } = useTranslation();
  const { isAdminUser, adminRosterMode } = useAdminRoster();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [pushTitle, setPushTitle] = useState('FlyFam');
  const [pushBody, setPushBody] = useState('');
  const [pushSending, setPushSending] = useState(false);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [groupAirline, setGroupAirline] = useState<'PGT' | ''>('PGT');
  const [groupRole, setGroupRole] = useState<'crew' | 'all'>('crew');
  const [groupPlatform, setGroupPlatform] = useState<'all' | 'ios' | 'android'>('ios');
  const [groupActiveDays, setGroupActiveDays] = useState<0 | 7 | 30 | 90>(30);
  const [groupTitle, setGroupTitle] = useState('FlyFam güncellendi');
  const [groupBody, setGroupBody] = useState(
    'Yeni iOS sürümü TestFlight’ta. Eski uygulamayı silip yeni davetten FlyFam’ı kurun.',
  );
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupStatus, setGroupStatus] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    const { data: res, error: invokeError } = await supabase.functions.invoke('admin-dashboard');
    if (invokeError) {
      setError(invokeError.message);
      setLoading(false);
      return;
    }
    setData((res as AdminDashboardResponse) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const users = useMemo(() => {
    const rows = data?.users?.rows ?? [];
    return rows.slice().sort((a, b) => userLabel(a).localeCompare(userLabel(b), 'tr'));
  }, [data?.users?.rows]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  const phaseHealth = data?.health?.phase_refresh ?? null;
  const healthy = !!phaseHealth?.healthy;
  const healthColor = phaseHealth ? (healthy ? '#15803d' : '#dc2626') : '#dc2626';
  const phaseSummary = useMemo(() => data?.flights?.phase_summary ?? {}, [data?.flights?.phase_summary]);

  const sendPush = useCallback(async () => {
    if (!selectedUserId) {
      setPushStatus('Kullanıcı seçin');
      return;
    }
    const body = pushBody.trim();
    if (!body) {
      setPushStatus('Mesaj gerekli');
      return;
    }
    const title = pushTitle.trim() || 'FlyFam';
    const label = selectedUser ? userLabel(selectedUser) : selectedUserId;
    Alert.alert('Push gönder', `${label}\n\n${title}\n${body}`, [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Gönder',
        onPress: () => {
          void (async () => {
            setPushSending(true);
            setPushStatus(null);
            const { data: res, error: invokeError } = await supabase.functions.invoke('admin-dashboard', {
              body: {
                action: 'send_push_notification',
                user_id: selectedUserId,
                title,
                body,
              },
            });
            setPushSending(false);
            if (invokeError) {
              setPushStatus(invokeError.message);
              return;
            }
            const json = res as {
              no_tokens?: boolean;
              sent?: number;
              token_count?: number;
              expo_errors?: string[];
            };
            if (json?.no_tokens) {
              setPushStatus('Kayıtlı push token yok');
              return;
            }
            const sent = Number(json?.sent ?? 0);
            const total = Number(json?.token_count ?? 0);
            if (sent <= 0) {
              const err = json?.expo_errors?.join('; ') || 'Expo hatası';
              setPushStatus(err);
              return;
            }
            setPushStatus(`Gönderildi (${sent}/${total} cihaz)`);
            setPushBody('');
          })();
        },
      },
    ]);
  }, [pushBody, pushTitle, selectedUser, selectedUserId]);

  const runGroupPush = useCallback(
    async (dryRun: boolean) => {
      const body = groupBody.trim();
      if (!dryRun && !body) {
        setGroupStatus('Mesaj gerekli');
        return;
      }
      const title = groupTitle.trim() || 'FlyFam';
      const payload = {
        action: 'send_group_push' as const,
        title,
        body: body || '(dry-run)',
        role: groupRole === 'all' ? 'all' : 'crew',
        airline_icao: groupAirline || undefined,
        platform: groupPlatform,
        active_within_days: groupActiveDays > 0 ? groupActiveDays : undefined,
        dry_run: dryRun,
        url: 'https://apps.apple.com/app/id6827960794',
      };
      const doInvoke = async () => {
        setGroupBusy(true);
        setGroupStatus(null);
        const { data: res, error: invokeError } = await supabase.functions.invoke('admin-dashboard', {
          body: payload,
        });
        setGroupBusy(false);
        if (invokeError) {
          setGroupStatus(invokeError.message);
          return;
        }
        const json = res as {
          users_matched?: number;
          users_with_tokens?: number;
          token_count?: number;
          sent?: number;
          dry_run?: boolean;
          expo_errors?: string[];
          audience?: { full_name?: string | null; has_token?: boolean }[];
        };
        if (json?.dry_run) {
          const named = (json.audience ?? [])
            .filter((a) => a.has_token)
            .map((a) => a.full_name || '?')
            .slice(0, 8)
            .join(', ');
          setGroupStatus(
            `Önizleme: ${json.users_matched ?? 0} üye · ${json.users_with_tokens ?? 0} tokenlı · ${json.token_count ?? 0} cihaz` +
              (named ? `\nÖrnek: ${named}` : ''),
          );
          return;
        }
        const sent = Number(json?.sent ?? 0);
        if (sent <= 0) {
          setGroupStatus(json?.expo_errors?.join('; ') || 'Gönderilemedi (token/Expo)');
          return;
        }
        setGroupStatus(
          `Gönderildi: ${sent} · eşleşen ${json.users_matched ?? 0} · tokenlı ${json.users_with_tokens ?? 0}`,
        );
      };
      if (dryRun) {
        await doInvoke();
        return;
      }
      Alert.alert(
        'Grup push',
        `${groupAirline || 'tüm airline'} · ${groupRole} · ${groupPlatform}` +
          (groupActiveDays ? ` · son ${groupActiveDays}g aktif` : ' · aktif filtresiz') +
          `\n\n${title}\n${body}`,
        [
          { text: 'İptal', style: 'cancel' },
          { text: 'Gönder', onPress: () => void doInvoke() },
        ],
      );
    },
    [groupActiveDays, groupAirline, groupBody, groupPlatform, groupRole, groupTitle],
  );

  if (!isAdminUser || !adminRosterMode) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Admin Panel</Text>
        <Text style={styles.muted}>Admin mode kapali veya yetki yok.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.title}>Admin Panel</Text>
      <Text style={styles.muted}>{data?.generated_at ? `Generated: ${fmt(data.generated_at)}` : 'Generated: -'}</Text>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Push Bildirimi</Text>
            <Text style={styles.mutedSmall}>Seçili kullanıcıya Expo push gönderir.</Text>
            <Text style={styles.fieldLabel}>Kullanıcı</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.userChips}>
              {users.map((u) => {
                const active = u.id === selectedUserId;
                const dev = Number(u.device_count ?? 0);
                return (
                  <TouchableOpacity
                    key={u.id}
                    style={[styles.chip, active && styles.chipActive, dev === 0 && styles.chipMuted]}
                    onPress={() => setSelectedUserId(u.id)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                      {userLabel(u)}
                      {dev > 0 ? ` · ${dev}` : ' · —'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {selectedUser && (
              <Text style={styles.mutedSmall}>
                Cihaz: {Number(selectedUser.device_count ?? 0) > 0
                  ? `${selectedUser.device_count} (${selectedUser.device_platforms_text || '?'})`
                  : 'yok'}
              </Text>
            )}
            <Text style={styles.fieldLabel}>Başlık</Text>
            <TextInput
              style={styles.input}
              value={pushTitle}
              onChangeText={setPushTitle}
              maxLength={100}
              placeholder="FlyFam"
              placeholderTextColor={colors.textSecondary}
            />
            <Text style={styles.fieldLabel}>Mesaj</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={pushBody}
              onChangeText={setPushBody}
              maxLength={500}
              multiline
              placeholder="Bildirim metni…"
              placeholderTextColor={colors.textSecondary}
            />
            <TouchableOpacity
              style={[styles.btn, (pushSending || !selectedUserId) && styles.btnDisabled]}
              onPress={() => void sendPush()}
              disabled={pushSending || !selectedUserId}
            >
              <Text style={styles.btnText}>{pushSending ? 'Gönderiliyor…' : 'Push Gönder'}</Text>
            </TouchableOpacity>
            {!!pushStatus && <Text style={pushStatus.startsWith('Gönderildi') ? styles.ok : styles.err}>{pushStatus}</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Grup Push (PGS / aktif)</Text>
            <Text style={styles.mutedSmall}>
              Inaktifleri ele: airline + son N gün aktif. Önce Önizleme, sonra Gönder.
            </Text>
            <Text style={styles.fieldLabel}>Airline</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.userChips}>
              {(
                [
                  { id: 'PGT' as const, label: 'PGT (PGS)' },
                  { id: '' as const, label: 'Tümü' },
                ] as const
              ).map((opt) => (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.chip, groupAirline === opt.id && styles.chipActive]}
                  onPress={() => setGroupAirline(opt.id)}
                >
                  <Text style={[styles.chipText, groupAirline === opt.id && styles.chipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Rol</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.userChips}>
              {(
                [
                  { id: 'crew' as const, label: 'Crew' },
                  { id: 'all' as const, label: 'Tümü' },
                ] as const
              ).map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.chip, groupRole === opt.id && styles.chipActive]}
                  onPress={() => setGroupRole(opt.id)}
                >
                  <Text style={[styles.chipText, groupRole === opt.id && styles.chipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Platform</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.userChips}>
              {(
                [
                  { id: 'ios' as const, label: 'iOS' },
                  { id: 'android' as const, label: 'Android' },
                  { id: 'all' as const, label: 'Tümü' },
                ] as const
              ).map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.chip, groupPlatform === opt.id && styles.chipActive]}
                  onPress={() => setGroupPlatform(opt.id)}
                >
                  <Text style={[styles.chipText, groupPlatform === opt.id && styles.chipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Aktiflik</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.userChips}>
              {(
                [
                  { id: 30 as const, label: '30 gün' },
                  { id: 7 as const, label: '7 gün' },
                  { id: 90 as const, label: '90 gün' },
                  { id: 0 as const, label: 'Filtre yok' },
                ] as const
              ).map((opt) => (
                <TouchableOpacity
                  key={String(opt.id)}
                  style={[styles.chip, groupActiveDays === opt.id && styles.chipActive]}
                  onPress={() => setGroupActiveDays(opt.id)}
                >
                  <Text style={[styles.chipText, groupActiveDays === opt.id && styles.chipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Başlık</Text>
            <TextInput
              style={styles.input}
              value={groupTitle}
              onChangeText={setGroupTitle}
              maxLength={100}
              placeholderTextColor={colors.textSecondary}
            />
            <Text style={styles.fieldLabel}>Mesaj</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={groupBody}
              onChangeText={setGroupBody}
              maxLength={500}
              multiline
              placeholderTextColor={colors.textSecondary}
            />
            <View style={styles.rowBtns}>
              <TouchableOpacity
                style={[styles.btnHalf, styles.btnOutline, groupBusy && styles.btnDisabled]}
                onPress={() => void runGroupPush(true)}
                disabled={groupBusy}
              >
                <Text style={styles.btnOutlineText}>{groupBusy ? '…' : 'Önizleme'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnHalf, groupBusy && styles.btnDisabled]}
                onPress={() => void runGroupPush(false)}
                disabled={groupBusy}
              >
                <Text style={styles.btnText}>Grup Gönder</Text>
              </TouchableOpacity>
            </View>
            {!!groupStatus && (
              <Text style={groupStatus.startsWith('Gönderildi') || groupStatus.startsWith('Önizleme') ? styles.ok : styles.err}>
                {groupStatus}
              </Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Phase Refresh Health</Text>
            <Text style={[styles.badge, { color: healthColor, borderColor: healthColor }]}>
              {phaseHealth ? `status: ${phaseHealth.status ?? 'unknown'}` : 'status: missing'}
            </Text>
            <Text style={styles.row}>Last success: {fmt(phaseHealth?.last_success_at)}</Text>
            <Text style={styles.row}>Last run: {fmt(phaseHealth?.last_run_at)}</Text>
            <Text style={styles.row}>Rows updated: {phaseHealth?.last_rows_updated ?? '-'}</Text>
            {!!phaseHealth?.last_error && <Text style={[styles.row, styles.err]}>Error: {phaseHealth.last_error}</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Flights / Phases</Text>
            <Text style={styles.row}>Total: {data?.flights?.total ?? '-'}</Text>
            <Text style={styles.row}>Active now: {data?.flights?.active_now ?? '-'}</Text>
            {Object.entries(phaseSummary).map(([k, v]) => (
              <Text key={k} style={styles.row}>
                {k}: {v}
              </Text>
            ))}
          </View>

          {!!error && <Text style={styles.err}>{error}</Text>}
          <TouchableOpacity style={styles.btnSecondary} onPress={() => void load()}>
            <Text style={styles.btnText}>{t('common.refresh') || 'Refresh'}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 6 },
  muted: { color: colors.textSecondary, marginBottom: 10 },
  mutedSmall: { color: colors.textSecondary, fontSize: 12, marginBottom: 6 },
  fieldLabel: { color: colors.text, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginTop: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 8 },
  row: { color: colors.text, marginBottom: 4 },
  err: { color: '#dc2626', marginTop: 6 },
  ok: { color: '#15803d', marginTop: 6 },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontWeight: '700',
    marginBottom: 8,
  },
  userChips: { flexGrow: 0, marginBottom: 4 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    maxWidth: 260,
    backgroundColor: colors.background,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
  chipMuted: { opacity: 0.55 },
  chipText: { color: colors.text, fontSize: 12 },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    backgroundColor: colors.background,
  },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  btn: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnSecondary: {
    marginTop: 14,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: colors.white, fontWeight: '700' },
  rowBtns: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btnHalf: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnOutline: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  btnOutlineText: { color: colors.primary, fontWeight: '700' },
});
