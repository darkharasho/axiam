import { getThemeById } from './themes';

let transitionTimer: ReturnType<typeof setTimeout> | null = null;

export function applyTheme(themeId?: string): string {
  const theme = getThemeById(themeId);
  const root = document.documentElement;

  // Add transition class for smooth crossfade
  root.classList.add('theme-transitioning');
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => {
    root.classList.remove('theme-transitioning');
    transitionTimer = null;
  }, 500);

  root.setAttribute('data-theme', theme.id);
  Object.entries(theme.vars).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
  return theme.id;
}
