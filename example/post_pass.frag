precision highp float;

#define NUM_SAMPLES 100

vec3 godrays(
    float density,
    float weight,
    float decay,
    float exposure,
    sampler2D occlusionTexture,
    vec2 screenSpaceSunPos,
    vec2 uv
    ) {

    vec3 fragColor = vec3(0.0,0.0,0.0);

	vec2 deltaTextCoord = vec2( uv - screenSpaceSunPos.xy );

	vec2 textCoo = uv.xy ;
	deltaTextCoord *= (1.0 /  float(NUM_SAMPLES)) * density;
	float illuminationDecay = 1.0;


	for(int i=0; i < NUM_SAMPLES ; i++)
	{
			textCoo -= deltaTextCoord;
			vec3 samp = texture2D(occlusionTexture, textCoo   ).xyz;

			samp *= illuminationDecay * weight;

			fragColor += samp;

			illuminationDecay *= decay;
	}

	fragColor *= exposure;

    return fragColor;


}

uniform sampler2D uBuffer;

varying vec2 vUv;
varying vec2 screenSpaceSunPos;




void main() {

    float density = 1.0;
    float weight = 0.01;
    float decay = 1.0;
    float exposure = 1.0;

vec3 fragColor = godrays(
    density,
    weight,
    decay,
    exposure,
    uBuffer,
    screenSpaceSunPos,
    vUv
    );

    gl_FragColor = vec4(fragColor , 1.0);
}