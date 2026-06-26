#version 300 es
// Stacked-alpha sample + cross-dissolve, ported from the proven /preview Stage
// (docs/008). Per-clip framing (anchor + scale + frame aspect) is resolved here,
// so two clips of different framings share one quad. The two slots are mixed in
// PREMULTIPLIED space to a single coverage — the character never goes translucent
// at a clip seam (the "ghost" bug). u_ambient is the room-light tint (HDRI hook);
// straight-alpha out, the framebuffer blend composites it over the room.
//
// MOUTH ERASE: each slot carries a per-frame mouth polygon (16 pts, clip-frame
// space = u) + skin colour. We flat-fill inside the polygon with skin, so a rigged
// mouth can be composited on top later. Done per-slot BEFORE the cross-dissolve, so
// both clips are cleaned independently during a transition. The polygon is stored
// raw (no dilation); `uMargin` dilates + feathers it analytically here, which stays
// crisp under the camera dolly-zoom (a raster mask would pixelate).
precision highp float;
in vec2 v_uv;
uniform sampler2D tA, tB;
uniform float mixv, feather, quadAspect, sclA, sclB, fasA, fasB;
uniform vec2 ancA, ancB, base;
uniform vec3 u_ambient;
// mouth-erase, A/B per slot (mirrors the ancA/ancB framing convention)
uniform vec2 uMouthA[16], uMouthB[16];
uniform vec3 uSkinA, uSkinB;       // skin fill, straight 0..1
uniform vec4 uBoxA, uBoxB;         // mouth AABB (x0,y0,x1,y1) for an early-out
uniform float uHasA, uHasB, uMargin, uMouthFeather;
uniform float uMouthOpen; // 0..1 lip-sync openness — vertical radius (global; both slots)
uniform float uMouthWide; // viseme horizontal-radius multiplier (1 = neutral; <1 round, >1 spread)
uniform float uMouthAngleA, uMouthAngleB; // rigged-mouth tilt per slot (radians; from face kp)
uniform float uEdgeFeather; // >0 only in the desktop overlay: blur the silhouette alpha this far
                            // (frame-space) so her edge feathers softly against the desktop instead
                            // of reading as a hard sticker cutout. 0 = off (the white room, untouched).
uniform sampler2D uAtlas;                 // viseme sprite atlas (5×4 mouth cells)
uniform float uMouthSprite;               // >0.5 = sample the atlas instead of the procedural ellipse
uniform float uVisemeA, uVisemeB, uVisemeBlend; // active viseme ids + cross-fade a→b
uniform float uSpriteScale;               // full mouth-sprite width in clip-u space
uniform float uSpriteAnchorY;             // cell row pinned at the mouth anchor (painted upper-lip row)
uniform float uSpriteYOffset;             // extra vertical nudge of the anchor in v_uv (base-px / 1184)
uniform vec2 uMouthAnchorA, uMouthAnchorB; // stable sprite anchor per slot (face-corner midpoint)
out vec4 o;

// Signed distance to a 16-gon (IQ). Negative inside, positive outside, in u-space.
float sdPoly(vec2 p, vec2 v[16]) {
  float d = dot(p - v[0], p - v[0]);
  float s = 1.0;
  for (int i = 0, j = 15; i < 16; j = i, i++) {
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

vec3 erase(vec3 rgb, vec2 u, vec2 poly[16], vec3 skin, vec4 box, float has) {
  if (has < 0.5) return rgb;
  // AABB early-out: skip the 16-edge loop for fragments nowhere near the mouth.
  float reach = uMargin + uMouthFeather; // erase covers this far past the polygon edge
  if (u.x < box.x - reach || u.x > box.z + reach ||
      u.y < box.y - reach || u.y > box.w + reach) return rgb;
  float d = sdPoly(u, poly);
  // Fully erased out to uMargin (the dilation), then feather OUTWARD over uMouthFeather.
  float cover = 1.0 - smoothstep(uMargin, uMargin + uMouthFeather, d);
  return mix(rgb, skin, cover);
}

// Sample the viseme atlas cell `vid` (0..18, 5×4 grid, origin top-left) at local cell coord
// `cell` (0..1). Cells beyond 18 fall in the blank slot 19 (transparent) → no draw.
vec4 atlasSample(float vid, vec2 cell) {
  float col = mod(vid, 5.0);
  float row = floor(vid / 5.0);
  vec2 uv = (vec2(col, row) + clamp(cell, 0.0, 1.0)) / vec2(5.0, 4.0);
  return texture(uAtlas, uv);
}

// Composite the rigged mouth into the already-erased mouth region. `box` = mouth AABB in
// u-space, centred + rotated by `angle`. With uMouthSprite: alpha-composite the active viseme
// atlas cell (cross-fading a→b). Otherwise a procedural ellipse (open=vertical, uMouthWide=
// horizontal) — the bootstrap look before the sprite atlas is wired in.
vec3 mouthDraw(vec3 rgb, vec2 u, vec4 box, float has, float open, float angle, vec2 ancVuv) {
  if (has < 0.5) return rgb;
  float s = sin(angle), co = cos(angle);
  if (uMouthSprite > 0.5) {
    // Size the sprite in v_uv (the billboard QUAD) — WORLD space. The quad is square and holds
    // the character at a constant on-screen size in EVERY framing (small/regular/large/wide are
    // just padded copies of the same character, scale-compensated), so the mouth is ONE fixed
    // size regardless of frame aspect (fas) or framing scale (scl). u-space sizing scaled with
    // both → the wide-clip stretch. The anchor (u-space face corner) is inverse-mapped to v_uv.
    vec2 q = v_uv - ancVuv;
    q = vec2(co * q.x + s * q.y, -s * q.x + co * q.y);
    float halfW = uSpriteScale * 0.5;
    float halfH = halfW;
    vec2 cell = vec2(0.5 + q.x / (2.0 * halfW), uSpriteAnchorY + q.y / (2.0 * halfH)); // anchor row (tunable)
    if (cell.x < 0.0 || cell.x > 1.0 || cell.y < 0.0 || cell.y > 1.0) return rgb;
    // atlas is premultiplied → blend then composite premultiplied-over (no edge fringe).
    vec4 sp = mix(atlasSample(uVisemeA, cell), atlasSample(uVisemeB, cell), uVisemeBlend);
    return rgb * (1.0 - sp.a) + sp.rgb;
  }
  vec2 c = vec2((box.x + box.z) * 0.5, (box.y + box.w) * 0.5);
  vec2 p = u - c;
  p = vec2(co * p.x + s * p.y, -s * p.x + co * p.y); // un-rotate into mouth-local space
  float w = box.z - box.x;
  float rx = w * 0.42 * uMouthWide;
  float ry = max(w * 0.04, w * 0.34 * open);
  float e = length(p / vec2(rx, ry));  // <1 inside the ellipse
  float inside = 1.0 - smoothstep(0.88, 1.12, e);
  return mix(rgb, vec3(0.18, 0.07, 0.09), inside); // dark interior, slightly warm
}

// Sample the silhouette alpha (bottom half of the stacked frame) at frame-space (x,y). v is clamped
// into the alpha half so feather taps near the frame top never bleed into the color half.
float aSample(sampler2D t, float x, float y) {
  return texture(t, vec2(x, clamp(0.5 + y * 0.5, 0.5, 1.0))).r;
}

// Map the quad uv into one clip's frame (feet anchor + framing scale + /fas for
// non-square frames), then read color (top half) / alpha (bottom half).
vec4 stk(sampler2D t, vec2 anc, float scl, float fas, vec2 poly[16], vec3 skin, vec4 box, float has, float angle, vec2 manc) {
  float k = scl;
  vec2 u = vec2(anc.x + (v_uv.x - 0.5) * quadAspect / (k * fas),
                anc.y + (v_uv.y - base.y) / k);
  if (u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0) return vec4(0.0);
  vec3 rgb = texture(t, vec2(u.x, u.y * 0.5)).rgb;
  rgb = erase(rgb, u, poly, skin, box, has);
  // Inverse-map the u-space mouth anchor (manc) into v_uv (quad) space, so the sprite can be
  // sized in the framing-invariant quad. (Inverts the u = ... mapping above.)
  vec2 ancVuv = vec2(0.5 + (manc.x - anc.x) * (k * fas) / quadAspect,
                     base.y + (manc.y - anc.y) * k + uSpriteYOffset); // + = mouth down (v_uv.y is down)
  rgb = mouthDraw(rgb, u, box, has, uMouthOpen, angle, ancVuv);
  float a;
  if (uEdgeFeather > 0.0) {
    // 3×3 gaussian-ish blur (4/2/1 weights) of the silhouette alpha → a soft feathered edge.
    float r = uEdgeFeather;
    a = aSample(t, u.x, u.y) * 4.0
      + (aSample(t, u.x + r, u.y) + aSample(t, u.x - r, u.y)
       + aSample(t, u.x, u.y + r) + aSample(t, u.x, u.y - r)) * 2.0
      + aSample(t, u.x + r, u.y + r) + aSample(t, u.x - r, u.y + r)
      + aSample(t, u.x + r, u.y - r) + aSample(t, u.x - r, u.y - r);
    a /= 16.0;
  } else {
    a = aSample(t, u.x, u.y);
  }
  float e = smoothstep(0.0, feather, u.x) * smoothstep(0.0, feather, 1.0 - u.x)
          * smoothstep(0.0, feather, u.y) * smoothstep(0.0, feather, 1.0 - u.y);
  return vec4(rgb, a * e);
}

void main() {
  vec4 a = stk(tA, ancA, sclA, fasA, uMouthA, uSkinA, uBoxA, uHasA, uMouthAngleA, uMouthAnchorA);
  vec4 b = stk(tB, ancB, sclB, fasB, uMouthB, uSkinB, uBoxB, uHasB, uMouthAngleB, uMouthAnchorB);
  // Premultiplied mix → one correct alpha. A transparent texel (a==0) carries
  // garbage rgb; premultiplying makes it contribute nothing, so the incoming clip
  // fades in cleanly. Un-premultiply for the straight-alpha output.
  vec4 m = mix(vec4(a.rgb * a.a, a.a), vec4(b.rgb * b.a, b.a), mixv);
  if (m.a <= 0.0001) discard;
  o = vec4((m.rgb / m.a) * u_ambient, m.a);
}
