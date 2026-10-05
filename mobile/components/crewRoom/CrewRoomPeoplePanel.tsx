import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { colors, useThemeMode } from '../../theme/colors';
import { radius, shadow } from '../../theme/tokens';
import {
  inviteCrewRoomContact,
  removeCrewRoomContact,
  respondCrewRoomRequest,
  type CrewRoomOverview,
  type CrewRoomPerson,
} from '../../lib/crewRoom';
import { CrewRoomAvatar, crewRoomErrorMessage } from './CrewRoomParts';

type Props = {
  overview: CrewRoomOverview;
  onOpenPerson: (crewId: string) => void;
  onChanged: () => void;
};

export function CrewRoomPeoplePanel({ overview, onOpenPerson, onChanged }: Props) {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { people, incoming, outgoing } = overview;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      onChanged();
    } catch (e) {
      Alert.alert(t('common.error'), crewRoomErrorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  const submitInvite = async () => {
    const email = inviteEmail.trim();
    if (!email.includes('@')) {
      Alert.alert(t('crewRoom.title'), t('crewRoom.add.invalidEmail'));
      return;
    }
    if (busy) return;
    setBusy('invite');
    try {
      const res = await inviteCrewRoomContact(email);
      Alert.alert(t('crewRoom.title'), t(`crewRoom.add.result.${res.result}`));
      if (res.result !== 'not_found' && res.result !== 'self') setInviteEmail('');
      onChanged();
    } catch (e) {
      Alert.alert(t('common.error'), crewRoomErrorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  const cardStyle = [styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  const personRow = (p: CrewRoomPerson, last: boolean) => {
    return (
      <TouchableOpacity
        key={p.crew_id}
        style={[styles.row, !last && styles.rowDivider]}
        onPress={() => onOpenPerson(p.crew_id)}
        accessibilityRole="button"
      >
        <CrewRoomAvatar name={p.name} uri={p.avatar_url} size={38} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {p.name ?? t('crewRoom.someone')}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={2}>
            {!p.has_access
              ? t('crewRoom.people.noSubscription')
              : t('crewRoom.people.theyShare', { level: t(`crewRoom.level.${p.their_level}`) })}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <View>
      <View style={cardStyle}>
        <Text style={styles.cardTitle}>{t('crewRoom.add.title')}</Text>
        <Text style={styles.cardHint}>{t('crewRoom.add.hint')}</Text>
        <View style={styles.inputRow}>
          <TextInput
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder={t('crewRoom.add.placeholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            style={styles.input}
            onSubmitEditing={submitInvite}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={[styles.primaryBtnSmall, (!inviteEmail.trim() || !!busy) && styles.disabled]}
            onPress={submitInvite}
            disabled={!inviteEmail.trim() || !!busy}
          >
            {busy === 'invite' ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Text style={styles.primaryBtnText}>{t('crewRoom.add.send')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {incoming.length > 0 ? (
        <View style={cardStyle}>
          <Text style={styles.cardTitle}>{t('crewRoom.requests.incoming', { count: incoming.length })}</Text>
          {incoming.map((r, i) => (
            <View key={r.link_id} style={[styles.row, i < incoming.length - 1 && styles.rowDivider]}>
              <CrewRoomAvatar name={r.name} uri={r.avatar_url} size={38} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {r.name ?? t('crewRoom.someone')}
                </Text>
                <Text style={styles.rowMeta}>{t('crewRoom.requests.wantsToConnect')}</Text>
              </View>
              <TouchableOpacity
                style={styles.secondaryBtnSmall}
                disabled={!!busy}
                onPress={() => void run(`resp-${r.link_id}`, () => respondCrewRoomRequest(r.link_id, false))}
              >
                <Text style={styles.secondaryBtnText}>{t('crewRoom.requests.decline')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryBtnSmall}
                disabled={!!busy}
                onPress={() => void run(`resp-${r.link_id}`, () => respondCrewRoomRequest(r.link_id, true))}
              >
                <Text style={styles.primaryBtnText}>{t('crewRoom.requests.accept')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      {outgoing.length > 0 ? (
        <View style={cardStyle}>
          <Text style={styles.cardTitle}>{t('crewRoom.requests.outgoing', { count: outgoing.length })}</Text>
          {outgoing.map((r, i) => (
            <View key={r.link_id} style={[styles.row, i < outgoing.length - 1 && styles.rowDivider]}>
              <CrewRoomAvatar name={r.name} uri={r.avatar_url} size={38} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {r.name ?? t('crewRoom.someone')}
                </Text>
                <Text style={styles.rowMeta}>{t('crewRoom.requests.waiting')}</Text>
              </View>
              <TouchableOpacity
                style={styles.secondaryBtnSmall}
                disabled={!!busy}
                onPress={() => void run(`cancel-${r.link_id}`, () => removeCrewRoomContact(r.link_id))}
              >
                <Text style={styles.secondaryBtnText}>{t('crewRoom.requests.cancel')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      <View style={cardStyle}>
        <Text style={styles.cardTitle}>{t('crewRoom.people.title', { count: people.length })}</Text>
        {people.length === 0 ? (
          <Text style={styles.cardHint}>{t('crewRoom.people.empty')}</Text>
        ) : (
          <>
            <Text style={styles.cardHint}>{t('crewRoom.people.tapHint')}</Text>
            {people.map((p, i) => personRow(p, i === people.length - 1))}
          </>
        )}
      </View>
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    card: {
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 16,
      marginBottom: 12,
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    cardHint: { fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 10, color: colors.textMuted },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    input: {
      flex: 1,
      minHeight: 44,
      borderRadius: radius.button,
      paddingHorizontal: 12,
      fontSize: 15,
      backgroundColor: colors.inputFill,
      color: colors.text,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, minHeight: 52 },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
    rowMeta: { fontSize: 12, marginTop: 2, color: colors.textMuted, lineHeight: 16 },
    primaryBtnSmall: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.primary,
      borderRadius: radius.button,
      paddingHorizontal: 14,
      minHeight: 40,
      justifyContent: 'center',
    },
    primaryBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
    secondaryBtnSmall: {
      borderRadius: radius.button,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      minHeight: 40,
      justifyContent: 'center',
    },
    secondaryBtnText: { color: colors.text, fontWeight: '600', fontSize: 14 },
    disabled: { opacity: 0.5 },
  });
}
