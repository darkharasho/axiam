import accentsJson from '@axiapps/axi-design/accents.json';

export type AccentDefinition = { id: string; label: string; hex: string };

export const ACCENTS: AccentDefinition[] = accentsJson;

export const DEFAULT_ACCENT_ID = 'crimson-red';

// Settings written by pre-redesign versions store a GW2 lore theme id.
const LEGACY_THEME_TO_ACCENT: Record<string, string> = {
    blood_legion: 'crimson-red',
    dragonstorm: 'crimson-red',
    charr_warband: 'amber-warm',
    ascalon_ember: 'amber-warm',
    human_kryta: 'axi-gold',
    elonian_sun: 'axi-gold',
    auric_basin: 'gold-bronze',
    norn_shiverpeak: 'refined-cyan',
    domain_of_ice: 'refined-cyan',
    mistlock_fractal: 'electric-blue',
    asura_inquest: 'teal-ocean',
    sylvari_grove: 'emerald-mint',
    jade_sea: 'emerald-mint',
    verdant_canopy: 'emerald-mint',
    priory_night: 'violet-purple',
    crystal_bloom: 'rose-pink',
    black_citadel: 'slate-silver',
};

export function resolveAccentId(id?: string): string {
    if (id && ACCENTS.some((a) => a.id === id)) return id;
    if (id && LEGACY_THEME_TO_ACCENT[id]) return LEGACY_THEME_TO_ACCENT[id];
    return DEFAULT_ACCENT_ID;
}
