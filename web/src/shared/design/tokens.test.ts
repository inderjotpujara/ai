import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, 'tokens.css'), 'utf8');

describe('Blueprint-Mono tokens', () => {
  it('imports Tailwind v4 and declares the class-toggled dark variant', () => {
    expect(css).toContain('@import "tailwindcss"');
    expect(css).toContain('@custom-variant dark');
  });
  it('defines the locked Blueprint-Mono palette literals', () => {
    expect(css).toContain('#0B0C0E'); // near-black base
    expect(css).toContain('#4C8DFF'); // blueprint-blue accent
    expect(css).toContain('#35D0C0'); // signal teal
  });
  it('ships both a dark base and a functional light theme', () => {
    expect(css).toMatch(/@theme/);
    expect(css).toMatch(/\.dark\b/);
  });
  it('honors prefers-reduced-motion', () => {
    expect(css).toContain('prefers-reduced-motion');
  });
});

describe('design tokens', () => {
  it('defines --color-danger in both the dark and light scopes', () => {
    const dark = css.slice(
      css.indexOf(':root {'),
      css.indexOf(':root:where(.light)'),
    );
    const light = css.slice(css.indexOf(':root:where(.light)'));
    expect(dark).toContain('--color-danger');
    expect(light).toContain('--color-danger');
  });
});

describe('a11y foundations (D1)', () => {
  it('defines a dedicated --color-focus-ring token and a global :focus-visible rule using it', () => {
    expect(css).toMatch(/--color-focus-ring:\s*#[0-9A-Fa-f]{6}/);
    expect(css).toMatch(
      /:focus-visible\s*\{[^}]*outline:[^}]*var\(--color-focus-ring\)/,
    );
  });

  it('ships a .sr-only utility for visually-hidden accessible label text', () => {
    expect(css).toMatch(/\.sr-only\s*\{/);
    // clip-based hiding, not display:none — must stay in the accessibility tree
    expect(css).toMatch(/\.sr-only\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
  });
});
