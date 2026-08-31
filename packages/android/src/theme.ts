// Shared colors + spacing so every screen stays consistent with the web app's
// dark accent look, without pulling in a styling library.
export const theme = {
  accent: '#7c6df2',
  accentDim: '#5a4fb8',
  bg: '#0f0f12',
  card: '#1a1a20',
  cardAlt: '#111116',
  elevated: '#22222b',
  text: '#f4f4f6',
  sub: '#9a9aa6',
  faint: '#63636e',
  online: '#3ecf8e',
  warn: '#f2b544',
  danger: '#f2555a',
  border: '#2a2a34',
} as const;

export const radius = {sm: 8, md: 12, lg: 16, xl: 20} as const;
