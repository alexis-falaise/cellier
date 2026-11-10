import { describe, expect, it } from 'vitest';
import {
  formatCover,
  formatCoverA11y,
  formatDayLabel,
  formatDayMonth,
  formatEuros,
  formatPriceCents,
  formatQuantity,
  formatRelativeTime,
  formatShortDate,
  formatTime,
} from './format';
import { NNBSP } from './typography';

const nb = (s: string) => s.replace(/ /g, NNBSP);
const normalizeSpaces = (s: string) => s.replace(/[  ]/g, ' ');

describe('formatQuantity', () => {
  it('keeps small masses in g and promotes to kg', () => {
    expect(formatQuantity(500, 'g')).toBe(nb('500 g'));
    expect(formatQuantity(1500, 'g')).toBe(nb('1,5 kg'));
    expect(formatQuantity(0.25, 'kg')).toBe(nb('250 g'));
    expect(formatQuantity(2, 'kg')).toBe(nb('2 kg'));
  });

  it('promotes volumes to L and keeps cl for bottles', () => {
    expect(formatQuantity(330, 'ml')).toBe(nb('330 ml'));
    expect(formatQuantity(1500, 'ml')).toBe(nb('1,5 L'));
    expect(formatQuantity(75, 'cl')).toBe(nb('75 cl'));
    expect(formatQuantity(150, 'cl')).toBe(nb('1,5 L'));
    expect(formatQuantity(0.5, 'l')).toBe(nb('50 cl'));
    expect(formatQuantity(0.3333, 'l')).toBe(nb('333,3 ml'));
  });

  it('counts pieces with a plural', () => {
    expect(formatQuantity(1, 'piece')).toBe('1 pièce');
    expect(formatQuantity(6, 'piece')).toBe('6 pièces');
  });
});

describe('prices', () => {
  it('formats euros with Intl', () => {
    expect(normalizeSpaces(formatEuros(1.89))).toBe('1,89 €');
    expect(normalizeSpaces(formatPriceCents(123450))).toBe('1 234,50 €');
    expect(formatPriceCents(189)).toBe(formatEuros(1.89));
  });
});

describe('dates', () => {
  const now = new Date(2026, 10, 14, 18, 40); // Saturday 14 November 2026

  it('formats times and short dates', () => {
    expect(formatTime(new Date(2026, 10, 14, 8, 5))).toBe('08:05');
    expect(formatShortDate(new Date(2026, 10, 12))).toBe('jeudi 12 nov.');
    expect(formatDayMonth(new Date(2026, 9, 3), now)).toBe('3 oct.');
    expect(formatDayMonth(new Date(2025, 9, 3), now)).toBe('3 oct. 2025');
  });

  it('phrases past timestamps relative to now', () => {
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(formatRelativeTime(ago(30_000), now)).toBe('à l’instant');
    expect(formatRelativeTime(ago(12 * 60_000), now)).toBe(`il y a 12${NNBSP}min`);
    expect(formatRelativeTime(new Date(2026, 10, 14, 14, 2), now)).toBe('aujourd’hui, 14:02');
    expect(formatRelativeTime(new Date(2026, 10, 13, 18, 40), now)).toBe('hier, 18:40');
    expect(formatRelativeTime(new Date(2026, 10, 9, 10, 0), now)).toBe('lundi');
    expect(formatRelativeTime(new Date(2026, 10, 7, 10, 0), now)).toBe('7 nov.');
    expect(formatRelativeTime(new Date(2025, 9, 3, 10, 0), now)).toBe('3 oct. 2025');
  });

  it('labels future days', () => {
    expect(formatDayLabel(new Date(2026, 10, 14, 22, 0), now)).toBe('aujourd’hui');
    expect(formatDayLabel(new Date(2026, 10, 15, 9, 0), now)).toBe('demain');
    expect(formatDayLabel(new Date(2026, 10, 19), now)).toBe('jeudi 19 nov.');
  });
});

describe('formatCover', () => {
  it('shows approximate days, then weeks from 14 days', () => {
    expect(formatCover(0.4)).toBe(`<${' '}1${NNBSP}j`);
    expect(formatCover(1)).toBe(nb('≈ 1 j'));
    expect(formatCover(4.4)).toBe(nb('≈ 4 j'));
    expect(formatCover(13.4)).toBe(nb('≈ 13 j'));
    expect(formatCover(14)).toBe(nb('≈ 2 sem.'));
    expect(formatCover(40)).toBe(nb('≈ 6 sem.'));
    expect(formatCover(90)).toBe('Plus de 2 mois');
  });

  it('has an accessible counterpart', () => {
    expect(formatCoverA11y(0.5)).toBe('Moins d’un jour de stock');
    expect(formatCoverA11y(1)).toBe('Environ 1 jour de stock');
    expect(formatCoverA11y(4)).toBe('Environ 4 jours de stock');
    expect(formatCoverA11y(21)).toBe('Environ 3 semaines de stock');
  });
});
