import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vitest.config.ts runs the src suite in the node environment, so the one
// browser global this module touches is stubbed rather than pulling in jsdom.
type FakeRoot = {
    attrs: Record<string, string>;
    classes: Set<string>;
    setAttribute: (k: string, v: string) => void;
    removeAttribute: (k: string) => void;
    classList: { add: (c: string) => void; remove: (c: string) => void };
};

function fakeRoot(): FakeRoot {
    const attrs: Record<string, string> = {};
    const classes = new Set<string>();
    return {
        attrs,
        classes,
        setAttribute: (k, v) => { attrs[k] = v; },
        removeAttribute: (k) => { delete attrs[k]; },
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    };
}

let root: FakeRoot;

beforeEach(() => {
    vi.resetModules();
    root = fakeRoot();
    vi.stubGlobal('document', { documentElement: root });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

async function load() {
    return import('./applyTheme');
}

describe('resolveSurfaceId', () => {
    it('defaults to the language itself', async () => {
        const { resolveSurfaceId, DEFAULT_SURFACE_ID } = await load();
        expect(DEFAULT_SURFACE_ID).toBe('axi');
        expect(resolveSurfaceId(null)).toBe('axi');
        expect(resolveSurfaceId(undefined)).toBe('axi');
    });

    it('passes through the ids the design language defines', async () => {
        const { resolveSurfaceId } = await load();
        expect(resolveSurfaceId('axi')).toBe('axi');
        expect(resolveSurfaceId('flat')).toBe('flat');
        expect(resolveSurfaceId('glass')).toBe('glass');
    });

    it('falls back to axi for anything else, including inherited property names', async () => {
        const { resolveSurfaceId } = await load();
        expect(resolveSurfaceId('frosted')).toBe('axi');
        expect(resolveSurfaceId('')).toBe('axi');
        expect(resolveSurfaceId('constructor')).toBe('axi');
        expect(resolveSurfaceId('__proto__')).toBe('axi');
        expect(resolveSurfaceId('toString')).toBe('axi');
    });
});

describe('applySurface', () => {
    it('puts a theme on <html>', async () => {
        const { applySurface } = await load();
        expect(applySurface('glass')).toBe('glass');
        expect(root.attrs['data-axi-theme']).toBe('glass');
    });

    it('treats flat as a theme like any other', async () => {
        const { applySurface } = await load();
        expect(applySurface('flat')).toBe('flat');
        expect(root.attrs['data-axi-theme']).toBe('flat');
    });

    it('removes the attribute for axi rather than naming the language', async () => {
        const { applySurface } = await load();
        applySurface('glass');
        expect(applySurface('axi')).toBe('axi');
        expect(root.attrs['data-axi-theme']).toBeUndefined();
    });

    it('crossfades so the whole app repaints together', async () => {
        const { applySurface } = await load();
        applySurface('glass');
        expect(root.classes.has('theme-transitioning')).toBe(true);
    });

    it('shares one fade with the accent (Review Focus 3)', async () => {
        vi.useFakeTimers();
        const { applySurface, applyTheme } = await load();
        applyTheme('electric-cyan');
        vi.advanceTimersByTime(300);
        applySurface('glass');
        // The accent's timer must have been cleared, not left to strip the class
        // 200ms into the surface's own fade.
        vi.advanceTimersByTime(300);
        expect(root.classes.has('theme-transitioning')).toBe(true);
        vi.advanceTimersByTime(250);
        expect(root.classes.has('theme-transitioning')).toBe(false);
        vi.useRealTimers();
    });
});
