import { describe, it, expect } from 'vitest';
import uz from '../uz.json';
import en from '../en.json';
import ru from '../ru.json';

type LocaleTree = Record<string, unknown>;

const locales: Record<string, LocaleTree> = { uz, en, ru };

function getByPath(tree: LocaleTree, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, tree);
}

// Keys referenced by components that previously rendered as raw keys / English text.
const requiredKeys = [
  'status.marketplace_on',
  'status.marketplace_off',
  'pos.shift_closed_title',
  'pos.shift_closed_hint',
];

describe('i18n key presence (live-test fixes #4)', () => {
  for (const [name, tree] of Object.entries(locales)) {
    for (const key of requiredKeys) {
      it(`${name}: "${key}" exists and is a non-empty string`, () => {
        const value = getByPath(tree, key);
        expect(typeof value).toBe('string');
        expect((value as string).trim().length).toBeGreaterThan(0);
      });
    }
  }

  it('shift_closed_hint is no longer English in the Uzbek locale', () => {
    expect(getByPath(uz, 'pos.shift_closed_hint')).not.toBe(
      'To start selling, please open a new shift.'
    );
  });
});
