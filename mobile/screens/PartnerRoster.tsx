import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Roster from './Roster';
import { demoPeersForUser, type DemoCrewPeer } from '../lib/crewPeerDemo';
import { useSession } from '../contexts/SessionContext';
import { colors } from '../theme/colors';

type RouteParams = {
  peerCrewId?: string;
  peerName?: string;
  peerAirline?: string | null;
};

type Props = {
  peer?: DemoCrewPeer | null;
  embeddedInTab?: boolean;
};

/** Crew↔crew takip: aile üyesinin gördüğü Roster UI (salt okunur). */
export default function PartnerRoster({ peer: peerProp = null }: Props) {
  const { i18n } = useTranslation();
  const { profile } = useSession();
  const route = useRoute();
  const routeParams = (route.params ?? {}) as RouteParams;
  const sessionPeer = useMemo(() => demoPeersForUser(profile?.id)[0] ?? null, [profile?.id]);
  const peer =
    peerProp ??
    (routeParams.peerCrewId
      ? {
          id: 'route-peer',
          peerCrewId: routeParams.peerCrewId,
          name: routeParams.peerName || 'Crew',
          airline: routeParams.peerAirline || '',
          icao: '',
        }
      : sessionPeer);
  const isTr = String(i18n.language || '').toLowerCase().startsWith('tr');

  if (!peer?.peerCrewId) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>
          {isTr ? 'Takip edilen crew yok.' : 'No followed crew.'}
        </Text>
      </View>
    );
  }

  return <Roster peerView={{ peerCrewId: peer.peerCrewId, peerName: peer.name }} />;
}

const styles = StyleSheet.create({
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  empty: { color: colors.textMuted, textAlign: 'center', padding: 24 },
});
