import { describe, expect, test } from 'bun:test';
import { otherTheme, resolveTheme, THEME_COLORS } from '../src/theme';

describe('theme', () => {
  test('defaults to dark unless light was saved explicitly', () => {
    expect(resolveTheme(null)).toBe('dark');
    expect(resolveTheme(undefined)).toBe('dark');
    expect(resolveTheme('')).toBe('dark');
    expect(resolveTheme('auto')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });
  test('toggles between the two themes', () => {
    expect(otherTheme('dark')).toBe('light');
    expect(otherTheme('light')).toBe('dark');
  });
  test('each theme has a browser chrome colour', () => {
    expect(THEME_COLORS.dark).toMatch(/^#[0-9a-f]{6}$/);
    expect(THEME_COLORS.light).toMatch(/^#[0-9a-f]{6}$/);
    expect(THEME_COLORS.dark).not.toBe(THEME_COLORS.light);
  });
});
