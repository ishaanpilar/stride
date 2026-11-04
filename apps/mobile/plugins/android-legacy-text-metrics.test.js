import { describe, expect, it } from 'vitest';

const plugin = require('./android-legacy-text-metrics');

const {
  EDIT_TEXT_STYLE,
  LEGACY_TEXT_ITEMS,
  TEXT_VIEW_STYLE,
  setLegacyTextMetrics,
} = plugin.__testables;

const getStyleItems = (xml, name) => {
  const style = xml.resources.style.find((entry) => entry.$.name === name);
  if (!style) return null;
  return Object.fromEntries(style.item.map((item) => [item.$.name, item]));
};

const makeStylesXml = () => ({
  resources: {
    style: [
      {
        $: { name: 'AppTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar' },
        item: [],
      },
    ],
  },
});

describe('android-legacy-text-metrics plugin', () => {
  it('points the app theme text widget styles at the legacy-metric styles', () => {
    const items = getStyleItems(setLegacyTextMetrics(makeStylesXml()), 'AppTheme');

    expect(items['android:textViewStyle']._).toBe(`@style/${TEXT_VIEW_STYLE.name}`);
    expect(items['android:editTextStyle']._).toBe(`@style/${EDIT_TEXT_STYLE.name}`);
    expect(items['editTextStyle']._).toBe(`@style/${EDIT_TEXT_STYLE.name}`);
  });

  it('pins pre-Android-15 text drawing behavior on both widget styles', () => {
    const xml = setLegacyTextMetrics(makeStylesXml());

    for (const styleName of [TEXT_VIEW_STYLE.name, EDIT_TEXT_STYLE.name]) {
      const items = getStyleItems(xml, styleName);
      expect(items).not.toBeNull();
      for (const [name, value, targetApi] of LEGACY_TEXT_ITEMS) {
        expect(items[name]._).toBe(value);
        if (targetApi) {
          expect(items[name].$['tools:targetApi']).toBe(targetApi);
        }
      }
    }
  });
});
