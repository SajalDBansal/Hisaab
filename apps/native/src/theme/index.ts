/**
 * Design tokens from design.md (black pills on white paper, hairline cards).
 * Use these everywhere instead of typing colours or sizes in screens.
 */
import { Platform } from "react-native";

export const colors = {
  // Brand: black is the only accent
  primary: "#000000",
  primaryPressed: "#090909",
  onPrimary: "#ffffff",

  // Surfaces
  canvas: "#ffffff",
  surfaceSoft: "#fafafa",
  surfaceDark: "#171717",
  hairline: "#e5e5e5",
  hairlineSoft: "#f0f0f0",
  hairlineStrong: "#d4d4d4",
  overlay: "rgba(0,0,0,0.45)",

  // Text
  ink: "#000000",
  charcoal: "#525252",
  body: "#737373",
  mute: "#a3a3a3",
  onDark: "#ffffff",
  onDarkMute: "rgba(255,255,255,0.7)",

  // Money and status (used sparingly, small text only)
  get: "#15803d", // "You'll get"
  give: "#b91c1c", // "You'll give"
  warn: "#b45309",
  warnBg: "#fffbeb",
  warnBorder: "#fcd34d",
  warnText: "#92400e",
  okBg: "#f0fdf4",
  okBorder: "#bbf7d0",
  okText: "#166534",
  badBg: "#fef2f2",
  badBorder: "#fecaca",
  badText: "#991b1b",
} as const;

/** 8px base grid. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  card: 12,
  sheet: 16,
  pill: 9999,
} as const;

/** Minimum touch target. */
export const touch = 44;

/** Fonts are loaded in app/_layout.tsx. Headings use rounded Nunito, body uses the system font. */
export const fonts = {
  heading: "Nunito_600SemiBold",
  headingBold: "Nunito_700Bold",
  body: Platform.select({ ios: "System", default: undefined }),
  mono: Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  }),
} as const;

export const type = {
  display: { fontFamily: fonts.heading, fontSize: 30, lineHeight: 36 },
  title: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: fonts.heading, fontSize: 18, lineHeight: 24 },
  body: { fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: "500" as const },
  small: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
  button: { fontSize: 14, lineHeight: 18, fontWeight: "500" as const },
} as const;
