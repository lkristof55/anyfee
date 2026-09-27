import { test } from "node:test";
import assert from "node:assert/strict";
import { keptThreeChunks, minifyGlsl } from "../scripts/build.ts";

test("minifyGlsl drops comments and indentation but keeps preprocessor lines intact", () => {
  const src = "\n\t#ifdef USE_MAP // a map\n\t\tvec4 c = texture2D( map, vUv ); /* sample */\n\n\t#endif\n";
  assert.equal(minifyGlsl(src), "#ifdef USE_MAP\nvec4 c = texture2D( map, vUv );\n#endif");
});

test("three shader chunks: everything meshbasic and linedashed include is kept, lighting is not", async () => {
  const kept = await keptThreeChunks();
  for (const c of ["common", "begin_vertex", "project_vertex", "map_fragment", "color_fragment", "fog_fragment", "logdepthbuf_fragment", "colorspace_fragment", "tonemapping_pars_fragment", "colorspace_pars_fragment"]) {
    assert.ok(kept.has(c), c);
  }
  for (const c of ["lights_physical_pars_fragment", "shadowmap_pars_fragment", "transmission_pars_fragment", "lights_fragment_begin"]) assert.ok(!kept.has(c), c);
});
