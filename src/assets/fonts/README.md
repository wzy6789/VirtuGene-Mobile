# Local UI typeface

Typeface: Noto Sans SC variable, distributed as the CSS family `VG Sans`.

Source: [Google Fonts — Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc), downloaded on 2026-10-02. The upstream font is `NotoSansSC[wght].ttf`; its SHA-256 is `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`. The accompanying SIL Open Font License is preserved in `OFL-NotoSansSC.txt`.

`scripts/build-ui-font.py` generates variable WOFF2 files with the original weight axis (100–900). It removes hint instructions and keeps horizontal UI layout features. All 30,890 supported codepoints are retained across the subsets: 2,255 codepoints used by shipped UI and punctuation are in the common file; the remaining glyphs are split into eight files and requested when needed.

The common file is 545,452 bytes and is preloaded by `index.html`. All nine compressed files total 8,798,388 bytes. The full upstream TTF and build dependencies are not shipped. No external font stylesheet is required at runtime.

To regenerate, download the upstream TTF and license into the same temporary directory, install `fonttools[woff]` in a build environment, and run:

```shell
python scripts/build-ui-font.py /path/to/NotoSansSC[wght].ttf
```

The script discovers UI codepoints from `src/**/*.ts` and `src/**/*.tsx` and writes `src/styles/ui-fonts.css`. Regenerate after adding UI text if it should be included in the preloaded subset. Unsupported characters continue to use the platform fallback stack.
