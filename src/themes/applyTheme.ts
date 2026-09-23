import { resolveAccentId } from './accents';

let transitionTimer: ReturnType<typeof setTimeout> | null = null;

export function applyTheme(themeId?: string): string {
    const id = resolveAccentId(themeId);
    const root = document.documentElement;

    root.classList.add('theme-transitioning');
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
        root.classList.remove('theme-transitioning');
        transitionTimer = null;
    }, 500);

    root.setAttribute('data-axi-accent', id);
    return id;
}
