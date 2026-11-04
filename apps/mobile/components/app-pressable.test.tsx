import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import renderer from 'react-test-renderer';
import { Pressable, Text, View } from 'react-native';
import { AppPressable } from './app-pressable';

const tokenState = vi.hoisted(() => ({
  isMaterial: false,
  isDark: false,
  rippleColor: undefined as string | undefined,
}));

vi.mock('../hooks/use-theme-tokens', () => ({
  useThemeTokens: () => ({
    isMaterial: tokenState.isMaterial,
    isDark: tokenState.isDark,
    state: {
      rippleColor: tokenState.rippleColor,
      stateLayerColor: () => (tokenState.isMaterial ? 'rgba(0, 0, 0, 0.1)' : 'transparent'),
    },
  }),
}));

const pressable = (tree: renderer.ReactTestRenderer) => tree.root.findByType(Pressable);

const pressIn = (tree: renderer.ReactTestRenderer) => {
  renderer.act(() => {
    pressable(tree).props.onPressIn({} as never);
  });
};

const pressOut = (tree: renderer.ReactTestRenderer) => {
  renderer.act(() => {
    pressable(tree).props.onPressOut({} as never);
  });
};

const findOverlays = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAllByType(View).filter((view) => {
    const style = view.props.style;
    const flat = Array.isArray(style)
      ? Object.assign({}, ...style.flat(Number.POSITIVE_INFINITY).filter(Boolean))
      : style;
    return flat && flat.position === 'absolute' && flat.backgroundColor;
  });

const flatStyle = (view: { props: Record<string, unknown> }) => {
  const style = view.props.style as unknown[];
  return Object.assign({}, ...style.flat(Number.POSITIVE_INFINITY).filter(Boolean));
};

describe('AppPressable', () => {
  it('adds no android_ripple under non-Material themes', () => {
    tokenState.isMaterial = false;
    tokenState.rippleColor = undefined;
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(
        <AppPressable>
          <Text>x</Text>
        </AppPressable>,
      );
    });
    expect(pressable(tree).props.android_ripple).toBeUndefined();
  });

  it('adds android_ripple under Material themes', () => {
    tokenState.isMaterial = true;
    tokenState.rippleColor = 'rgba(26, 28, 30, 0.1)';
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(
        <AppPressable>
          <Text>x</Text>
        </AppPressable>,
      );
    });
    expect(pressable(tree).props.android_ripple).toEqual({ color: 'rgba(26, 28, 30, 0.1)' });
  });

  it('shows a pressed overlay under non-Material themes and clears it on release', () => {
    tokenState.isMaterial = false;
    tokenState.isDark = false;
    tokenState.rippleColor = undefined;
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(
        <AppPressable style={{ borderRadius: 14 }}>
          <Text>x</Text>
        </AppPressable>,
      );
    });
    expect(findOverlays(tree).length).toBe(0);

    pressIn(tree);
    const overlays = findOverlays(tree);
    expect(overlays.length).toBe(1);
    const flat = flatStyle(overlays[0]);
    expect(flat.backgroundColor).toBe('rgba(0, 0, 0, 0.08)');
    expect(flat.borderRadius).toBe(14);

    pressOut(tree);
    expect(findOverlays(tree).length).toBe(0);
  });

  it('uses an explicit pressedColor override and chains onPressIn', () => {
    tokenState.isMaterial = false;
    tokenState.isDark = true;
    const onPressIn = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(
        <AppPressable pressedColor="rgba(0, 0, 0, 0.18)" onPressIn={onPressIn}>
          <Text>x</Text>
        </AppPressable>,
      );
    });
    pressIn(tree);
    const overlays = findOverlays(tree);
    expect(overlays.length).toBe(1);
    expect(flatStyle(overlays[0]).backgroundColor).toBe('rgba(0, 0, 0, 0.18)');
    expect(onPressIn).toHaveBeenCalledTimes(1);
  });
});
