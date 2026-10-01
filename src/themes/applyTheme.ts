import { resolveAccentId } from './accents';

let transitionTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Holds the crossfade class on <html> for the length of the transition so the
 * whole app changes together. Shared by the accent and the surface: changing
 * both at once should still be one fade, so the timer is not per-attribute.
 */
function crossfade(root: Element): void {
    root.classList.add('theme-transitioning');
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
        root.classList.remove('theme-transitioning');
        transitionTimer = null;
    }, 500);
}

export function applyTheme(themeId?: string): string {
    const id = resolveAccentId(themeId);
    const root = document.documentElement;

    crossfade(root);

    root.setAttribute('data-axi-accent', id);
    return id;
}

/**
 * The surfaces the design language paints. 'axi' is the language itself, drawn
 * with no `data-axi-theme` at all. 'flat' and 'glass' are repaints of it
 * shipped as `@axiapps/axi-design/themes/<id>.css`.
 */
export type SurfaceId = 'axi' | 'flat' | 'glass';

export const SURFACES: { id: SurfaceId; label: string }[] = [
    { id: 'axi', label: 'Axi' },
    { id: 'flat', label: 'Flat' },
    { id: 'glass', label: 'Glass' },
];

/** AxiAM has always been drawn in the language itself, so that stays the default. */
export const DEFAULT_SURFACE_ID: SurfaceId = 'axi';

/** Always returns one of the three ids. Membership is tested against the array
 *  rather than an object, so inherited property names are unknown values like
 *  any other. */
export function resolveSurfaceId(id?: string | null): SurfaceId {
    return SURFACES.some((s) => s.id === id) ? (id as SurfaceId) : DEFAULT_SURFACE_ID;
}

/**
 * Puts a surface on <html>. 'axi' removes the attribute rather than naming
 * itself: the language is not a theme layered over itself, and axi-design's own
 * rule is that removing `data-axi-theme` leaves you back on it unchanged.
 *
 * Does not persist — the main-process settings store is the source of truth and
 * the caller writes it, exactly as it does for the accent.
 */
export function applySurface(surfaceId?: string | null): SurfaceId {
    const id = resolveSurfaceId(surfaceId);
    const root = document.documentElement;

    crossfade(root);

    if (id === 'axi') root.removeAttribute('data-axi-theme');
    else root.setAttribute('data-axi-theme', id);

    return id;
}
