precision highp float;


#pragma glslify: godrays = require(../index.glsl)



uniform sampler2D uOcclusionTexture;
varying vec2 vUv;

uniform vec2 uScreenSpaceSunPos;

uniform float uDensity;
uniform float uWeight;
uniform float uDecay;
uniform float uExposure;
uniform int uNumSamples;


void main() {

vec3 fragColor = godrays(
    uDensity,
    uWeight,
    uDecay,
    uExposure,
    uNumSamples,
    uOcclusionTexture,
    uScreenSpaceSunPos,
    vUv
    );

    gl_FragColor = vec4(fragColor , 1.0);
}