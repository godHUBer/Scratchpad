// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Avatar } from './Avatar';

/*
  Reported from the deployed app: when a profile picture is present, the name's
  initials are drawn on top of it.

  The original component rendered both children unconditionally — an <img> and an
  absolutely-positioned initials <span> — so the initials were always stamped
  over the photo. These tests pin down that exactly one of the two is painted.
*/

afterEach(cleanup);

describe('Avatar', () => {
  it('shows only the photo when a picture is present', () => {
    const { container } = render(<Avatar name="Ada Lovelace" url="https://example.com/ada.png" />);
    expect(container.querySelector('img')).toBeTruthy();
    // The regression: initials sat over the image.
    expect(container.textContent).not.toContain('AL');
  });

  it('shows initials when there is no picture', () => {
    const { container } = render(<Avatar name="Ada Lovelace" url={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('AL');
  });

  it('treats an empty url as no picture', () => {
    // Profile rows return '' as often as null; both mean "no photo".
    const { container } = render(<Avatar name="Ada Lovelace" url="" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('AL');
  });

  it('falls back to initials when the image fails to load', () => {
    /*
      The old onError only hid the <img>, revealing nothing behind it, so a broken
      URL produced an empty coloured circle. A broken avatar should degrade to the
      initials, which is the whole point of having them.
    */
    const { container } = render(<Avatar name="Ada Lovelace" url="https://example.com/404.png" />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    fireEvent.error(img!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('AL');
  });

  it('keeps the accessible name in every state', () => {
    // The visible glyph is aria-hidden, so the sr-only label has to carry the
    // name regardless of which visual branch is showing.
    for (const url of [null, 'https://example.com/ada.png']) {
      const { container, unmount } = render(<Avatar name="Ada Lovelace" url={url} />);
      expect(container.textContent).toContain('Ada Lovelace');
      unmount();
    }
  });

  it('falls back to a generic label when there is no name', () => {
    const { container } = render(<Avatar name={null} url={null} />);
    expect(container.textContent).toContain('Teammate');
  });
});
