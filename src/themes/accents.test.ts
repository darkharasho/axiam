import { describe, it, expect } from 'vitest';
import { ACCENTS, DEFAULT_ACCENT_ID, resolveAccentId } from './accents';

describe('the accent list', () => {
    it('is the eleven official accents', () => {
        expect(ACCENTS).toHaveLength(11);
        expect(ACCENTS.map((a) => a.id)).toContain('crimson-red');
        expect(ACCENTS[0].id).toBe('axi-gold');
    });
});

describe('resolveAccentId', () => {
    it('passes an official id through', () => {
        expect(resolveAccentId('teal-ocean')).toBe('teal-ocean');
    });

    it('maps every legacy GW2 theme id per the spec table', () => {
        const table: Record<string, string> = {
            blood_legion: 'crimson-red', dragonstorm: 'crimson-red',
            charr_warband: 'amber-warm', ascalon_ember: 'amber-warm',
            human_kryta: 'axi-gold', elonian_sun: 'axi-gold',
            auric_basin: 'gold-bronze',
            norn_shiverpeak: 'refined-cyan', domain_of_ice: 'refined-cyan',
            mistlock_fractal: 'electric-blue',
            asura_inquest: 'teal-ocean',
            sylvari_grove: 'emerald-mint', jade_sea: 'emerald-mint', verdant_canopy: 'emerald-mint',
            priory_night: 'violet-purple',
            crystal_bloom: 'rose-pink',
            black_citadel: 'slate-silver',
        };
        for (const [legacy, accent] of Object.entries(table)) {
            expect(resolveAccentId(legacy)).toBe(accent);
        }
    });

    it('falls back to crimson-red for unknown and missing ids', () => {
        expect(resolveAccentId('garbage')).toBe(DEFAULT_ACCENT_ID);
        expect(resolveAccentId(undefined)).toBe(DEFAULT_ACCENT_ID);
        expect(DEFAULT_ACCENT_ID).toBe('crimson-red');
    });
});
