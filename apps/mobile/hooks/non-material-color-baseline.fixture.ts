import { THEME_PRESETS } from '../constants/theme-presets';
import type { ThemeContextType } from '../contexts/theme-context';

type Resolvable = Pick<ThemeContextType, 'isDark' | 'themeStyle' | 'themePreset' | 'themeMode'>;


export const DEFAULT_LIGHT = {
  bg: '#F0F4F8', cardBg: '#FFFFFF', taskItemBg: '#FFFFFF',
  text: '#1F2937', secondaryText: '#4B5563', icon: '#4B5563',
  border: '#E3E8F0', tint: '#4F46E5', onTint: '#FFFFFF',
  tabIconDefault: '#4B5563', tabIconSelected: '#4F46E5',
  inputBg: '#E9EEF4', danger: '#B91C1C', success: '#15803D',
  warning: '#C2410C', filterBg: '#E9EEF4',
};
export const DEFAULT_DARK = {
  bg: '#14161C', cardBg: '#1E222A', taskItemBg: '#1E222A',
  text: '#F3F4F6', secondaryText: '#A1A8B5', icon: '#A1A8B5',
  border: '#2A2E37', tint: '#908BEE', onTint: '#14161C',
  tabIconDefault: '#A1A8B5', tabIconSelected: '#908BEE',
  inputBg: '#171A20', danger: '#F87171', success: '#4ADE80',
  warning: '#FB923C', filterBg: '#171A20',
};

export const NON_MATERIAL_CASES: { name: string; theme: Resolvable; expected: Record<string, string> }[] = [
  { name: 'default-light', theme: { isDark: false, themeStyle: 'default', themePreset: 'default', themeMode: 'light' }, expected: DEFAULT_LIGHT },
  { name: 'default-dark', theme: { isDark: true, themeStyle: 'default', themePreset: 'default', themeMode: 'dark' }, expected: DEFAULT_DARK },
  { name: 'eink', theme: { isDark: false, themeStyle: 'default', themePreset: 'eink', themeMode: 'eink' }, expected: THEME_PRESETS.eink },
  { name: 'nord', theme: { isDark: true, themeStyle: 'default', themePreset: 'nord', themeMode: 'nord' }, expected: THEME_PRESETS.nord },
  { name: 'catppuccin-macchiato', theme: { isDark: true, themeStyle: 'default', themePreset: 'catppuccin-macchiato', themeMode: 'catppuccin-macchiato' }, expected: THEME_PRESETS['catppuccin-macchiato'] },
  { name: 'dracula', theme: { isDark: true, themeStyle: 'default', themePreset: 'dracula', themeMode: 'dracula' }, expected: THEME_PRESETS.dracula },
  { name: 'gruvbox-light', theme: { isDark: false, themeStyle: 'default', themePreset: 'gruvbox-light', themeMode: 'gruvbox-light' }, expected: THEME_PRESETS['gruvbox-light'] },
  { name: 'gruvbox-dark', theme: { isDark: true, themeStyle: 'default', themePreset: 'gruvbox-dark', themeMode: 'gruvbox-dark' }, expected: THEME_PRESETS['gruvbox-dark'] },
  { name: 'sepia', theme: { isDark: false, themeStyle: 'default', themePreset: 'sepia', themeMode: 'sepia' }, expected: THEME_PRESETS.sepia },
  { name: 'oled', theme: { isDark: true, themeStyle: 'default', themePreset: 'oled', themeMode: 'oled' }, expected: THEME_PRESETS.oled },
];
