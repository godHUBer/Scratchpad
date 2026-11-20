// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJson, readString, removeKey, writeJson, writeString } from './storage';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('safe storage', () => {
  it('round-trips strings', () => {
    expect(writeString('k', 'v')).toBe(true);
    expect(readString('k')).toBe('v');
  });

  it('round-trips JSON', () => {
    expect(writeJson('arr', [1, 2])).toBe(true);
    expect(readJson('arr', [], (v): v is number[] => Array.isArray(v))).toEqual([1, 2]);
  });

  it('returns the fallback for malformed JSON instead of throwing', () => {
    window.localStorage.setItem('bad', '{not json');
    expect(readJson('bad', ['safe'], (v): v is string[] => Array.isArray(v))).toEqual(['safe']);
  });

  it('returns the fallback when the shape is wrong', () => {
    window.localStorage.setItem('shape', '{"a":1}');
    expect(readJson('shape', [], (v): v is string[] => Array.isArray(v))).toEqual([]);
  });

  it('survives a blocked localStorage on read', () => {
    // Accessing localStorage at all throws in blocked-storage contexts.
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readString('k')).toBeNull();
  });

  it('survives a blocked localStorage on write', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(writeString('k', 'v')).toBe(false);
    expect(writeJson('k', { a: 1 })).toBe(false);
  });

  it('survives a full quota', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(writeString('k', 'v')).toBe(false);
  });

  it('removes a key, and tolerates blocked storage', () => {
    writeString('k', 'v');
    expect(removeKey('k')).toBe(true);
    expect(readString('k')).toBeNull();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(removeKey('k')).toBe(false);
  });

  it('survives a value JSON cannot represent', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(writeJson('c', circular)).toBe(false);
  });
});
