#if !defined INCLUDE_LIB_CLOUDS_SHAPE
#define INCLUDE_LIB_CLOUDS_SHAPE

/*
--------------------------------------------------------------------------------

	References:
		[Schneider, 2015] Andrew Schneider. “The Real-Time Volumetric Cloudscapes Of Horizon: Zero Dawn”. SIGGRAPH 2015.
			https://www.slideshare.net/guerrillagames/the-realtime-volumetric-cloudscapes-of-horizon-zero-dawn
		[Schneider, 2016] Andrew Schneider. "GPU Pro 7: Real Time Volumetric Cloudscapes". p.p. (97-128) CRC Press, 2016.
			https://www.taylorfrancis.com/chapters/edit/10.1201/b21261-11/real-time-volumetric-cloudscapes-andrew-schneider
		[Schneider, 2017] Andrew Schneider. "Nubis: Authoring Realtime Volumetric Cloudscapes with the Decima Engine". SIGGRAPH 2017.
			https://advances.realtimerendering.com/s2017/Nubis%20-%20Authoring%20Realtime%20Volumetric%20Cloudscapes%20with%20the%20Decima%20Engine%20-%20Final.pptx
		[Schneider, 2022] Andrew Schneider. "Nubis, Evolved: Real-Time Volumetric Clouds for Skies, Environments, and VFX". SIGGRAPH 2022.
			https://advances.realtimerendering.com/s2022/SIGGRAPH2022-Advances-NubisEvolved-NoVideos.pdf
		[Schneider, 2023] Andrew Schneider. "Nubis Cubed: Methods (and madness) to model and render immersive real-time voxel-based clouds". SIGGRAPH 2023.
			https://advances.realtimerendering.com/s2023/Nubis%20Cubed%20(Advances%202023).pdf
		[Hillaire, 2016] Sebastien Hillaire. “Physically based Sky, Atmosphere and Cloud Rendering”. SIGGRAPH 2016.
			https://blog.selfshadow.com/publications/s2016-shading-course/
			https://www.ea.com/frostbite/news/physically-based-sky-atmosphere-and-cloud-rendering
		[Högfeldt, 2016] Rurik Högfeldt. "Convincing Cloud Rendering: An Implementation of Real-Time Dynamic Volumetric Clouds in Frostbite". Department of Computer Science and Engineering, Gothenburg, Sweden, 2016.
			https://publications.lib.chalmers.se/records/fulltext/241770/241770.pdf
		[Bauer, 2019] Fabian Bauer. "Creating the Atmospheric World of Red Dead Redemption 2: A Complete and Integrated Solution". SIGGRAPH 2019.
			https://www.advances.realtimerendering.com/s2019/slides_public_release.pptx
		[Wrenninge et al., 2013] Magnus Wrenninge, Chris Kulla, Viktor Lundqvist. “Oz: The Great and Volumetric”. SIGGRAPH 2013 Talks.
			https://dl.acm.org/doi/10.1145/2504459.2504518

--------------------------------------------------------------------------------
*/

#include "/lib/atmosphere/clouds/Common.glsl"
#ifdef REV_CU_DETAIL_NOISE
	uniform sampler3D revDetailNoiseTex;
#endif

//================================================================================================//

// [Schneider, 2023]
float ValueErosion(float value, float oldMin) {
	return saturate((value - oldMin) / (1.0 - oldMin));
}

float CloudHighDensity(vec2 rayPos) {
	// Wind field
	const vec2 windVelocity = vec2(cos(cloudLayer2.windAngle), sin(cloudLayer2.windAngle)) * cloudLayer2.windSpeed;
	vec2 windOffset = windVelocity * worldTimeCounter;

	const mat2 goldenRotate = mat2(cos(goldenAngle), -sin(goldenAngle), sin(goldenAngle), cos(goldenAngle));

	rayPos -= windOffset;
	rayPos += cameraPosition.xz;

    // Sample cloud coverage
    // R: Ci, G: Cs, B: Cc, A: shared
	vec4 cloudMap = texture(cloudMapHi, rayPos * rcp(REV_HI_MAP_SCALE * 1e3));

    float localCoverage = cloudMap.w;
    if (localCoverage < cloudDensityEpsilon) return 0.0;

	float activeCoverage = 0.0;

	#ifdef CLOUD_CI
		float coverageCi = cube(saturate(cloudMap.x * (1.0 + CLOUD_CI_COVERAGE) - 0.5));
		activeCoverage = coverageCi;
	#endif

	#ifdef CLOUD_CS
		float coverageCs = cube(saturate(cloudMap.y * (1.0 + CLOUD_CS_COVERAGE) - 0.5));
		activeCoverage += coverageCs;
	#endif

	#ifdef CLOUD_CC
		float coverageCc = cube(saturate(cloudMap.z * (1.0 + CLOUD_CC_COVERAGE) - 0.5) * 2.0);
		activeCoverage += coverageCc;
	#endif

	if (activeCoverage < EPS) return 0.0;

	vec2 curlNoise = texture(curlNoise2D, rayPos * rcp(REV_HI_CURL_SCALE * 1e3)).xy;

	vec2 position = rayPos * 1e-3 - windOffset * 5e-4 + curlNoise * REV_HI_CURL_STRENGTH;
    position *= goldenRotate;

    vec2 lookupPos = position * 0.05 - localCoverage * 0.1;

    vec3 shapes = sqr(texture(cirroLutTex, lookupPos * 2.0).xyz);
    shapes = mix(shapes, texture(cirroLutTex, lookupPos).xyz, cloudMap.xyz);

	float density = 0.0;

	// Cirrus clouds
	#ifdef CLOUD_CI
		density = shapes.x * coverageCi;
	#endif

	// Cirrostratus clouds
	#ifdef CLOUD_CS
		density += shapes.y * coverageCs;
	#endif

	// Cirrocumulus clouds
	#ifdef CLOUD_CC
		density += shapes.z * coverageCc;
	#endif

    density *= sqr(localCoverage) * REV_HI_DENSITY;
	return saturate(density);
}

//================================================================================================//

float GetVerticalProfile(float heightFraction, float cloudType) {
    return texture(verticalLut, vec2(cloudType, heightFraction)).x;
}

const float cloudProfileEpsilon = 0.05;

const uint cloudDensityModeCoarse = 0u;
const uint cloudDensityModeBase = 1u;
const uint cloudDensityModeDetail = 2u;

float CloudVolumeDensity(vec3 rayPos, float heightFraction, out float dimensionalProfile, uint sampleMode) {
	dimensionalProfile = 0.0;

	// Wind field
	const vec3 windDir = vec3(cos(cloudLayer0.windAngle), REV_LOW_WIND_VERTICAL, sin(cloudLayer0.windAngle));
	const vec3 windVelocity = windDir * cloudLayer0.windSpeed;
	vec3 windOffset = windVelocity * worldTimeCounter;

	rayPos -= windOffset;
	rayPos.xz += cameraPosition.xz;

	// Sample cloud map
	vec2 cloudMap = texture(cloudMapLo, rayPos.xz * rcp(REV_CU_MAP_SCALE * 1e3)).xy;

	// Coverage profile
	vec2 stepEdge = mix(vec2(0.7, 1.0) - CLOUD_CU_COVERAGE * 0.5, vec2(0.1, 0.3), sqr(wetness) * REV_CU_RAIN_COVERAGE);
	float coverage = linearstep(stepEdge.x, stepEdge.y, cloudMap.x);
	if (coverage < 0.1) return 0.0;

	float localCoverage = texture(noisetex, rayPos.xz * rcp(REV_CU_LOCAL_COVERAGE_SCALE * 1e3) + 0.75).z;
	coverage *= linearstep(stepEdge.x, stepEdge.y * 0.8, localCoverage);

	// Press heightFraction via raw coverage(cloudMap.x)
	heightFraction = saturate(heightFraction / cloudMap.x);

	// Vertical profile
	float gradient = GetVerticalProfile(heightFraction, cloudMap.y);
	dimensionalProfile = gradient * coverage;
	if (dimensionalProfile < cloudProfileEpsilon) return 0.0;

	#ifdef CLOUD_EMPTY_SPACE_SKIP
	if (sampleMode == cloudDensityModeCoarse) return dimensionalProfile;
	#endif

	vec3 noisePos = rayPos - windDir * heightFraction * cloudLayer0.thickness * REV_CU_NOISE_SKEW;
	noisePos.y += dot(noisePos.xz, vec2(0.2, 0.3)); // Reduce repetition pattern
	noisePos *= rcp(2e3) * REV_CU_BASE_NOISE_SCALE;

	// Add curl noise
	#if !defined PASS_SKY_MAP
	if (sampleMode == cloudDensityModeDetail) {
		vec3 curlNoise = texture(curlNoise3D, noisePos * REV_CU_CURL_SCALE).xyz;
		noisePos += curlNoise * gradient * oms(coverage) * REV_CU_CURL_STRENGTH;
	}
	#endif

	float baseNoise = texture(baseNoiseTex, noisePos).x;

	// Noise erosion
	float erosion = oms(baseNoise * gradient) * REV_CU_EROSION;
	float cloudDensity = dimensionalProfile - erosion;
	if (cloudDensity < cloudDensityEpsilon) return 0.0;

	// Optional high-frequency detail erosion (enhancement, not in upstream Revelation)
	#if defined REV_CU_DETAIL_NOISE && !defined PASS_SKY_MAP
	if (sampleMode == cloudDensityModeDetail) {
		float detailNoise = texture(revDetailNoiseTex, noisePos * REV_CU_DETAIL_NOISE_SCALE).x;
		// [Schneider, 2015] wispy at the bottom -> billowy at the top
		detailNoise = mix(detailNoise, oms(detailNoise), saturate(heightFraction * 4.0));
		cloudDensity -= detailNoise * oms(dimensionalProfile) * 0.2 * REV_CU_DETAIL_STRENGTH;
		if (cloudDensity < cloudDensityEpsilon) return 0.0;
	}
	#endif

	float heightFade = smoothstep(0.1, 0.5, heightFraction);

	// Density profile
	cloudDensity *= mix(1.0, inversesqrt(cloudDensity), dimensionalProfile);
	return cloudDensity * mix(CLOUD_CU_DENSITY_B, CLOUD_CU_DENSITY_T, heightFade);
}

#endif // INCLUDE_LIB_CLOUDS_SHAPE
