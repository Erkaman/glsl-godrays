vec3 godrays(
    float density,
    float weight,
    float decay,
    float exposure,
    int numSamples,
    sampler2D occlusionTexture,
    vec2 screenSpaceLightPos,
    vec2 uv
    ) {

    vec3 fragColor = vec3(0.0,0.0,0.0);

	vec2 deltaTextCoord = vec2( uv - screenSpaceLightPos.xy );

	vec2 textCoo = uv.xy ;
	deltaTextCoord *= (1.0 /  float(numSamples)) * density;
	float illuminationDecay = 1.0;


	for(int i=0; i < 100 ; i++){


        /*
        This makes sure that the loop only runs `numSamples` many times.
        We have to do it this way in WebGL, since you can't have a for loop
        that runs a variable number times in WebGL.
        This little hack gets around that.

        But the drawback of this is that we have to specify an upper bound to the
        number of iterations(but 100 is good enough for almost all cases.)
        */
	    if(numSamples < i) {
            break;
	    }

		textCoo -= deltaTextCoord;
		vec3 samp = texture2D(occlusionTexture, textCoo   ).xyz;
		samp *= illuminationDecay * weight;
		fragColor += samp;
		illuminationDecay *= decay;
	}

	fragColor *= exposure;

    return fragColor;


}


#pragma glslify: export(godrays)
