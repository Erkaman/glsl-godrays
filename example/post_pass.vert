precision highp float;

attribute vec2 position;

varying vec2 vUv;
varying vec2 screenSpaceSunPos;

uniform mat4 uProjection;
uniform mat4 uView;
uniform vec3 uSunDir;

void main() {
    vUv = 0.5 * (position+1.0);

    gl_Position = vec4(position.xy, 0.0, 1.0);

    vec4 temp = uProjection * uView * vec4(uSunDir , 1.0);

    screenSpaceSunPos = 0.5 * (temp.xy * (1.0 / temp.w) + 1.0);
}