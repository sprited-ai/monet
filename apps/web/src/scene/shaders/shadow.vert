#version 300 es
// A flat quad on the floor plane (y≈0) under a character — projected by the real
// camera, so it foreshortens correctly (the RO ground shadow). a_pos is [-1,1]².
layout(location = 0) in vec2 a_pos;
uniform mat4 u_view, u_proj;
uniform vec3 u_pos;   // feet world position
uniform vec2 u_size;  // shadow radii (x, z) in world units
out vec2 v_uv;
void main() {
  vec3 world = u_pos + vec3(a_pos.x * u_size.x, 0.01, a_pos.y * u_size.y);
  gl_Position = u_proj * u_view * vec4(world, 1.0);
  v_uv = a_pos;
}
