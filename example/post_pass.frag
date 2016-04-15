precision highp float;

uniform sampler2D uBuffer;

varying vec2 uv;
varying vec2 screenSpaceSunPos;

#define NUM_SAMPLES 100


/*
    float Density = 0.8;
    float Weight = 10.5;
    float Decay = 0.99;
    float Exposure = 0.003;
*/

void main() {


    float density = 1.0;
    float weight = 0.01;
    float decay = 1.0;
    float exposure = 1.0;

    vec4 fragColor = vec4(0.0,0.0,0.0,0.0);

	vec2 deltaTextCoord = vec2( uv - screenSpaceSunPos.xy );
	vec2 textCoo = uv.xy;
	deltaTextCoord *= (1.0 /  float(NUM_SAMPLES)) * density;
	float illuminationDecay = 1.0;


	for(int i=0; i < NUM_SAMPLES ; i++)
	{
			textCoo -= deltaTextCoord;
			vec4 samp = texture2D(uBuffer, textCoo );

			samp *= illuminationDecay * weight;

			fragColor += samp;

			illuminationDecay *= decay;
	}

	fragColor *= exposure;

    gl_FragColor = fragColor;


 //gl_FragColor = vec4(texture2D(uBuffer, uv ).x*200.0, 0.0, 0.0, 1.0);

}