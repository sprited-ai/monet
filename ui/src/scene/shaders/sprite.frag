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

// Map the quad uv into one clip's frame (feet anchor + framing scale + /fas for
// non-square frames), then read color (top half) / alpha (bottom half).
vec4 stk(sampler2D t, vec2 anc, float scl, float fas, vec2 poly[16], vec3 skin, vec4 box, float has) {
  float k = scl;
  vec2 u = vec2(anc.x + (v_uv.x - 0.5) * quadAspect / (k * fas),
                anc.y + (v_uv.y - base.y) / k);
  if (u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0) return vec4(0.0);
  vec3 rgb = texture(t, vec2(u.x, u.y * 0.5)).rgb;
  rgb = erase(rgb, u, poly, skin, box, has);
  float a = texture(t, vec2(u.x, 0.5 + u.y * 0.5)).r;
  float e = smoothstep(0.0, feather, u.x) * smoothstep(0.0, feather, 1.0 - u.x)
          * smoothstep(0.0, feather, u.y) * smoothstep(0.0, feather, 1.0 - u.y);
  return vec4(rgb, a * e);
}

void main() {
  vec4 a = stk(tA, ancA, sclA, fasA, uMouthA, uSkinA, uBoxA, uHasA);
  vec4 b = stk(tB, ancB, sclB, fasB, uMouthB, uSkinB, uBoxB, uHasB);
  // Premultiplied mix → one correct alpha. A transparent texel (a==0) carries
  // garbage rgb; premultiplying makes it contribute nothing, so the incoming clip
  // fades in cleanly. Un-premultiply for the straight-alpha output.
  vec4 m = mix(vec4(a.rgb * a.a, a.a), vec4(b.rgb * b.a, b.a), mixv);
  if (m.a <= 0.0001) discard;
  o = vec4((m.rgb / m.a) * u_ambient, m.a);
}
