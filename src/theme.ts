export const THEME_KEY = 'anonfolio.theme.v1';
export type Theme = 'dark' | 'light';
export const THEME_COLORS: Record<Theme, string> = { dark: '#0f1211', light: '#f5f7f6' };

// Dark is the default on every device: the theme is an explicit choice saved in
// this browser, never inferred from the operating system preference.
export function resolveTheme(stored: string | null | undefined): Theme {
  return stored === 'light' ? 'light' : 'dark';
}
export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
export function loadTheme(): Theme {
  try { return resolveTheme(localStorage.getItem(THEME_KEY)); } catch { return 'dark'; }
}
export function saveTheme(theme: Theme) {
  try { localStorage.setItem(THEME_KEY, theme); return true; } catch { return false; }
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}
