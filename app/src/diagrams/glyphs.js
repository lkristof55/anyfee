// Stroke glyphs on a 24x24 grid, drawn by the SVG renderer (as paths) and by the WebGL engine
// (Path2D onto a canvas texture). Simple marks, not brand logos: a git branch for GitHub, an X for X.
export const GLYPHS = {
  github:
    "M4.8 5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0M4.8 19a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0M14.8 7a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0M7 7.2V16.8M17 9.2C17 14 7 12.5 7 16.8",
  x: "M5.5 4.5L18.5 19.5M18.5 4.5L5.5 19.5",
};

export const GLYPH_STROKE = 1.9; // in glyph units (of 24)
