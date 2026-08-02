import { I18nManager, Platform } from 'react-native';

/**
 * The whole app is Hebrew, so RTL is forced rather than left to the device
 * locale — a dogfooder running an English phone should still get the intended
 * layout. `forceRTL` takes effect after a reload on native, which is why it's
 * called at module load rather than inside a component.
 */
export function enforceRtl(): void {
  if (!I18nManager.isRTL) {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
  }
}

export const colors = {
  background: '#F6F5F2',
  surface: '#FFFFFF',
  border: '#E4E1DA',
  text: '#1C1B18',
  textMuted: '#6E6A62',
  accent: '#1F6F5C',
  accentSoft: '#E7F1ED',
  warning: '#8A5A1E',
  warningSoft: '#FBF0DF',
  danger: '#8C2F2F',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 14, lg: 20 } as const;

export const font = {
  title: { fontSize: 26, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 19, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 13, color: colors.textMuted },
  mono: {
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    color: colors.textMuted,
  },
} as const;
