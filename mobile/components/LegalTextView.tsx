import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  LEGAL_TEXT_VERSION,
  privacyNoticeText,
  termsDisclaimerText,
} from '../lib/legalTexts';
import { colors, useThemeMode } from '../theme/colors';
import { radius, spacing } from '../theme/tokens';
import { ScreenPageHeader } from './ScreenPageHeader';
import { PrimaryButton } from './PrimaryButton';
import { BottomActionBar } from './BottomActionBar';

export type LegalDocumentKind = 'privacy' | 'terms';

type ParsedBlock =
  | { type: 'warning'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'para'; text: string };

type Props = {
  kind: LegalDocumentKind;
  /** Signup sheet: show accept CTA and call onAccept. Settings push: false. */
  showAccept?: boolean;
  onAccept?: () => void;
  onBack?: () => void;
};

function sentenceCaseHeading(raw: string): string {
  const trimmed = raw.replace(/^\d+\.\s*/, '').trim();
  if (!trimmed) return raw;
  const lower = trimmed.toLocaleLowerCase('tr-TR');
  const numbered = raw.match(/^(\d+\.)\s*/);
  const prefix = numbered ? `${numbered[1]} ` : '';
  return prefix + lower.charAt(0).toLocaleUpperCase('tr-TR') + lower.slice(1);
}

function isMainSectionHeading(line: string): boolean {
  return /^\d+\.\s+\S/.test(line) && !/^\d+\.\d+/.test(line);
}

function parseLegalBody(raw: string): { warning: string | null; blocks: ParsedBlock[] } {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  // Skip document title + version line
  while (i < lines.length && (lines[i].trim() === '' || !/^\d+\./.test(lines[i]) && !/ÖNEMLİ|IMPORTANT/i.test(lines[i]))) {
    i += 1;
    if (i > 6) break;
  }

  let warning: string | null = null;
  const blocks: ParsedBlock[] = [];
  let paraBuf: string[] = [];

  const flushPara = () => {
    const t = paraBuf.join(' ').trim();
    if (t) blocks.push({ type: 'para', text: t });
    paraBuf = [];
  };

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      flushPara();
      continue;
    }
    if (/^(ÖNEMLİ|IMPORTANT)/i.test(line)) {
      flushPara();
      warning = line.replace(/^(ÖNEMLİ UYARI|IMPORTANT WARNING|ÖNEMLİ|IMPORTANT)\s*:?\s*/i, '').trim() || line;
      continue;
    }
    if (isMainSectionHeading(line)) {
      flushPara();
      blocks.push({ type: 'heading', text: sentenceCaseHeading(line) });
      continue;
    }
    paraBuf.push(line);
  }
  flushPara();
  return { warning, blocks };
}

function versionPillLabel(lang: string): string {
  const isTr = String(lang).toLowerCase().startsWith('tr');
  const ver = LEGAL_TEXT_VERSION.includes('v5') ? 'v5' : LEGAL_TEXT_VERSION;
  return isTr ? `${ver} · 19 May 2026` : `${ver} · 19 May 2026`;
}

/**
 * Shared legal document chrome — roster theme, no blue header.
 */
export function LegalTextView({ kind, showAccept = false, onAccept, onBack }: Props) {
  const { t, i18n } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);

  const raw =
    kind === 'privacy' ? privacyNoticeText(i18n.language ?? 'en') : termsDisclaimerText(i18n.language ?? 'en');
  const parsed = useMemo(() => parseLegalBody(raw), [raw]);

  const title = kind === 'privacy' ? t('legal.privacyHeading') : t('legal.termsHeading');
  const subtitle = kind === 'privacy' ? t('legal.privacySubtitle') : t('legal.termsSubtitle');

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenPageHeader title={title} subtitle={subtitle} onBack={onBack} />
      <View style={styles.pillRow}>
        <View style={[styles.versionPill, { backgroundColor: colors.inputFill }]}>
          <Text style={[styles.versionPillText, { color: colors.textMuted }]}>
            {versionPillLabel(i18n.language ?? 'en')}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, showAccept && styles.contentWithBar]}
        keyboardShouldPersistTaps="handled"
      >
        {parsed.warning ? (
          <View
            style={[
              styles.warningCard,
              {
                backgroundColor: colors.warningBg,
                borderColor: colors.warningBorder,
              },
            ]}
          >
            <View style={[styles.warningStripe, { backgroundColor: colors.warningText }]} />
            <Ionicons name="warning-outline" size={18} color={colors.warningText} style={styles.warningIcon} />
            <Text style={[styles.warningText, { color: colors.warningText }]}>{parsed.warning}</Text>
          </View>
        ) : null}

        {parsed.blocks.map((b, idx) =>
          b.type === 'heading' ? (
            <Text key={`h-${idx}`} style={[styles.heading, { color: colors.text }]}>
              {b.text}
            </Text>
          ) : (
            <Text key={`p-${idx}`} style={[styles.para, { color: colors.textSecondary }]}>
              {b.text}
            </Text>
          ),
        )}
      </ScrollView>

      {showAccept ? (
        <BottomActionBar>
          <PrimaryButton title={t('legal.acceptCta')} onPress={() => onAccept?.()} />
        </BottomActionBar>
      ) : null}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    root: { flex: 1 },
    pillRow: {
      paddingHorizontal: spacing.xl,
      paddingBottom: 8,
    },
    versionPill: {
      alignSelf: 'flex-start',
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    versionPillText: {
      fontSize: 12,
      fontWeight: '600',
    },
    scroll: { flex: 1 },
    content: {
      paddingHorizontal: spacing.xl,
      paddingBottom: 80,
    },
    contentWithBar: {
      paddingBottom: 24,
    },
    warningCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth * 2,
      paddingVertical: 12,
      paddingRight: 14,
      paddingLeft: 10,
      marginBottom: 18,
      overflow: 'hidden',
    },
    warningStripe: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 4,
    },
    warningIcon: {
      marginLeft: 8,
      marginTop: 1,
      marginRight: 8,
    },
    warningText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
    },
    heading: {
      fontSize: 16,
      fontWeight: '800',
      marginTop: 18,
      marginBottom: 8,
    },
    para: {
      fontSize: 15,
      lineHeight: Math.round(15 * 1.3),
      marginBottom: 10,
    },
  });
}
