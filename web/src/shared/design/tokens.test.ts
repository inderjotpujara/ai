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
