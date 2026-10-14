/*
--------------------------------------------------------------------------------

	Revelation Shaders

	Copyright (C) 2026 HaringPro
	Apache License 2.0

	Pass: Post-processing compositing

--------------------------------------------------------------------------------
*/

//======// Utility //=============================================================================//

#include "/lib/Utility.glsl"

#define TONE_MAPPER 64 // [0 1 2 3 16 17 32 33 48 64]
#define HDR_TONE_MAPPER 33 // [0 3 16 17 32 33]

#define OPENDRT_PRESET opendrt_preset_default // [opendrt_preset_default opendrt_preset_arriba opendrt_preset_sylvan opendrt_preset_colorful opendrt_preset_aery opendrt_preset_dystopic opendrt_preset_umbra opendrt_preset_custom]
#define OPENDRT_TONESCALE_PRESET opendrt_tonescale_optimized // [opendrt_tonescale_optimized opendrt_tonescale_default opendrt_tonescale_low_contrast opendrt_tonescale_medium_contrast opendrt_tonescale_high_contrast opendrt_tonescale_arriba opendrt_tonescale_sylvan opendrt_tonescale_colorful opendrt_tonescale_aery opendrt_tonescale_dystopic opendrt_tonescale_umbra opendrt_tonescale_aces_1x opendrt_tonescale_aces_2 opendrt_tonescale_marvelous opendrt_tonescale_dagrinchi opendrt_tonescale_custom]
#define OPENDRT_MIDDLE_GREY 18.0 // [8.0 9.0 10.0 11.0 12.0 13.0 14.0 15.0 16.0 17.0 18.0 19.0 20.0 22.0 24.0]

// 0: disables gamut compression, 1: Rec.2020, 2: P3-D65
#define ACES_HDR_TARGET_GAMUT 1 // [0 1 2]

#define GAMMA_CORRECTION 2.2 // [1.0 1.1 1.2 1.3 1.4 1.5 1.6 1.7 1.8 1.9 2.0 2.1 2.2 2.3 2.4 2.5 2.6 2.7 2.8 2.9 3.0 3.1 3.2 3.3 3.4 3.5 3.6 3.7 3.8 3.9 4.0 4.1 4.2 4.3 4.4 4.5 4.6 4.7 4.8 4.9 5.0]

#define BLOOM_BLENDING_MODE 1 // [0 1 2]
#define BLOOM_INTENSITY 1.0 // [0.0 0.01 0.02 0.05 0.07 0.1 0.15 0.2 0.3 0.4 0.5 0.6 0.7 0.8 0.9 1.0 1.1 1.2 1.3 1.4 1.5 1.6 1.7 1.8 1.9 2.0 3.0 4.0 5.0 7.0 10.0 15.0 20.0]
#define BLOOMY_FOG_INTENSITY 1.0 // [0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.75 0.8 0.9 1.0 1.1 1.2 1.3 1.4 1.5 1.6 1.7 1.8 1.9 2.0 2.5 3.0 3.5 4.0 5.0]

#define PURKINJE_SHIFT
// #define PURKINJE_SHIFT_NOISE
#define PURKINJE_SHIFT_STRENGTH 0.3 // [0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8 0.9 1.0]

// #define VIGNETTE_ENABLED
#define VIGNETTE_STRENGTH 1.0 // [0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8 0.9 1.0 1.1 1.2 1.3 1.4 1.5 1.6 1.7 1.8 1.9 2.0 2.5 3.0 3.5 4.0 5.0]
#define VIGNETTE_ROUNDNESS 0.5 // [0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8 0.9 1.0 1.1 1.2 1.3 1.4 1.5 1.6 1.7 1.8 1.9 2.0 2.5 3.0 3.5 4.0 5.0]

#define COLOR_CONTRAST 100 // [0 5 10 15 20 25 30 35 40 45 50 55 60 65 70 75 80 85 90 95 100 105 110 115 120 125 130 135 140 145 150 155 160 165 170 175 180 185 190 195 200]
#define COLOR_SATURATION 100 // [0 5 10 15 20 25 30 35 40 45 50 55 60 65 70 75 80 85 90 95 100 105 110 115 120 125 130 135 140 145 150 155 160 165 170 175 180 185 190 195 200]

//======// Output //==============================================================================//

/* RENDERTARGETS: 0 */
out vec3 color; // Tonemapped output

//======// Uniform //=============================================================================//

#include "/lib/universal/Uniform.glsl"

//======// SSBO //================================================================================//

#include "/lib/universal/SSBO.glsl"

//======// Function //============================================================================//

#include "/lib/universal/Random.glsl"

void CombineBloomAndFog(inout vec3 scene, vec2 screenCoord, float exposure) {
	vec3 bloomData = texture(colortex4, screenCoord * 0.5).rgb;

	float bloomIntensity = BLOOM_INTENSITY * 0.1;

	#ifdef BLOOMY_FOG
		float fogMask = texture(colortex0, scaleScreenUv(screenCoord)).w;
		bloomIntensity = max(bloomIntensity, fogMask * BLOOMY_FOG_INTENSITY);
	#endif

	// Exposure adaptation
	bloomIntensity /= max(exposure, 1.0) + 1.0;

	#if BLOOM_BLENDING_MODE == 0
		scene += bloomData * bloomIntensity;
	#elif BLOOM_BLENDING_MODE == 1
		scene = mix(scene, bloomData, bloomIntensity);
	#else
		scene = (scene + bloomData * bloomIntensity) / (1.0 + bloomIntensity * 0.5);
	#endif

	if (rainStrength > 1e-2) {
		float rainAlpha = texture(colortex6, scaleScreenUv(screenCoord)).a;
		rainAlpha = oms(rainAlpha) * RAIN_VISIBILITY;
		scene = scene * oms(rainAlpha) + bloomData * rainAlpha * 1.25;
	}
}

float MesopicAdaptation(float exposure) {
	#if EXPOSURE_MODE == MANUAL
		float adaptedLogLuminance = log2(0.18 / exposure);
	#else
		float exposureEv = log2(maxEps(exposure) * rcp(0.18));
		float exposureCurve = mix(0.65, 1.0, nightVision);
		float adaptedLogLuminance = (AUTO_EV_BIAS - exposureEv) / exposureCurve;
	#endif

	return 1.0 - smoothstep(-8.0, -2.0, adaptedLogLuminance);
}

vec3 ScotopicVision(vec3 color, float mesopicFactor) {
	const vec3 photopicResponse = vec3(0.2627002, 0.6779981, 0.0593017);
	// Normalized from Ys = -0.702 X + 1.039 Y + 0.433 Z.
	const vec3 scotopicResponse = vec3(-0.2065580, 0.7293298, 0.4772282);

	float photopicLuminance = max0(dot(color, photopicResponse));
	float scotopicLuminance = max0(dot(color, scotopicResponse));

	#ifdef PURKINJE_SHIFT_NOISE
		scotopicLuminance *= 0.5 + SampleStbnVec1(ivec2(gl_FragCoord.xy), frameCounter);
	#endif

	float localFactor = rcp(1.0 + 2.0 * photopicLuminance);
	float rodWeight = saturate(PURKINJE_SHIFT_STRENGTH * mesopicFactor * localFactor);

	float rodLuminance = min(scotopicLuminance, 2.0 * photopicLuminance);
	return mix(color, vec3(rodLuminance), rodWeight);
}

vec3 None(vec3 x) {
	return x;
}

// Lottes 2016, "Advanced Techniques and Optimization of HDR Color Pipelines"
// https://gpuopen.com/wp-content/uploads/2016/03/GdcVdrLottes.pdf
vec3 Lottes(vec3 x) {
	x *= 2.0;

	const vec3 a      = vec3(1.35);
	const vec3 d      = vec3(0.92);
	const vec3 hdrMax = vec3(8.0);
	const vec3 midIn  = vec3(0.2);
	const vec3 midOut = vec3(0.3);

	const vec3 ad = a * d;
	const vec3 curvedMidIn = pow(midIn, a);
	const vec3 curvedHdrMax = pow(hdrMax, a);
	const vec3 b = -curvedMidIn + curvedHdrMax * midOut;
	const vec3 c = pow(hdrMax, ad) * curvedMidIn - curvedHdrMax * pow(midIn, ad) * midOut;

	return sRGBToLinear(pow(x, a) * (pow(hdrMax, ad) - pow(midIn, ad)) * midOut / (pow(x, ad) * b + c));
}

#include "/lib/post/ACES.glsl"
#include "/lib/post/AgX.glsl"
#include "/lib/post/GT.glsl"
#include "/lib/post/OpenDRT.glsl"

//======// OpenDRT Custom //======================================================================//
// Defaults = Standard preset (opendrt_preset_default)

/* Tonescale (Tonescale = Custom) */
#define OPENDRT_C_CONTRAST      1.66  // [0.8 0.9 1.0 1.05 1.1 1.15 1.2 1.3 1.4 1.5 1.6 1.66 1.7 1.8 1.9 2.0]
#define OPENDRT_C_SHOULDER      0.5   // [0.0 0.1 0.2 0.3 0.35 0.4 0.5 0.6 0.7 0.8 1.0]
#define OPENDRT_C_TOE           0.003 // [0.0 0.001 0.003 0.005 0.01 0.02 0.03 0.04 0.06 0.08 0.1 0.15 0.2]
#define OPENDRT_C_OFFSET        0.005 // [0.0 0.001 0.003 0.005 0.006 0.008 0.01 0.015 0.02 0.03]
#define OPENDRT_C_SURROUND      0     // [0 1 2]
#define OPENDRT_C_HCON_ENABLE   0     // [0 1]
#define OPENDRT_C_HCON          0.0   // [-1.0 -0.75 -0.5 -0.25 0.0 0.25 0.5 0.55 0.75 1.0]
#define OPENDRT_C_HCON_PIVOT    1.0   // [-1.0 0.0 0.5 1.0 1.5 2.0 3.0]
#define OPENDRT_C_HCON_START    4.0   // [0.5 1.0 2.0 3.0 4.0 5.0 6.0]
#define OPENDRT_C_LCON_ENABLE   0     // [0 1]
#define OPENDRT_C_LCON          0.0   // [0.0 0.1 0.25 0.4 0.5 0.75 1.0 1.13 1.25 1.5 2.0]
#define OPENDRT_C_LCON_WIDTH    0.5   // [0.1 0.2 0.3 0.5 0.6 0.75 1.0 1.5 2.0]

/* Look (Preset = Custom) */
#define OPENDRT_C_CWP           2     // [0 1 2 3 4 5]
#define OPENDRT_C_CWP_LIMIT     0.25  // [0.0 0.1 0.25 0.5 0.75 1.0]
#define OPENDRT_C_RS_STRENGTH   0.35  // [0.0 0.1 0.2 0.25 0.3 0.35 0.4 0.5 0.6]
#define OPENDRT_C_RS_RED_W      0.25  // [0.1 0.15 0.2 0.25 0.3 0.35 0.4]
#define OPENDRT_C_RS_BLUE_W     0.55  // [0.3 0.4 0.45 0.5 0.55 0.6]

#define OPENDRT_C_PT_LOW        0.25  // [0.0 0.05 0.1 0.15 0.25 0.35 0.5 0.75 1.0]
#define OPENDRT_C_PT_LOW_R      0.5   // [0.0 0.1 0.25 0.45 0.5 0.75 1.0]
#define OPENDRT_C_PT_LOW_G      0.0   // [0.0 0.05 0.1 0.15 0.25 0.5]
#define OPENDRT_C_PT_LOW_B      0.1   // [0.0 0.05 0.1 0.15 0.25 0.5]
#define OPENDRT_C_PT_HIGH       0.25  // [0.0 0.1 0.15 0.25 0.35 0.5]
#define OPENDRT_C_PT_HIGH_R     0.5   // [0.0 0.1 0.15 0.25 0.5 0.75]
#define OPENDRT_C_PT_HIGH_B     0.0   // [0.0 0.1 0.15 0.25 0.5]

#define OPENDRT_C_PTL_ENABLE    1     // [0 1]
#define OPENDRT_C_PTL_C         0.06  // [0.0 0.02 0.04 0.05 0.06 0.08 0.1 0.15 0.2]
#define OPENDRT_C_PTL_M         0.08  // [0.0 0.02 0.04 0.05 0.06 0.08 0.1 0.15 0.2]
#define OPENDRT_C_PTL_Y         0.06  // [0.0 0.02 0.04 0.05 0.06 0.08 0.1 0.15 0.2]

#define OPENDRT_C_PTM_ENABLE    1     // [0 1]
#define OPENDRT_C_PTM_LOW       0.4   // [0.0 0.25 0.4 0.5 0.8 1.0 1.5]
#define OPENDRT_C_PTM_LOW_RNG   0.25  // [0.1 0.25 0.35 0.4 0.5 0.75 1.0]
#define OPENDRT_C_PTM_LOW_ST    0.5   // [0.1 0.25 0.4 0.5 0.66 0.8 1.0]
#define OPENDRT_C_PTM_HIGH      -0.8  // [-1.0 -0.9 -0.8 -0.6 -0.4 -0.2 0.0]
#define OPENDRT_C_PTM_HIGH_RNG  0.35  // [0.1 0.25 0.35 0.45 0.5 0.6 0.66 0.8 1.0]
#define OPENDRT_C_PTM_HIGH_ST   0.4   // [0.1 0.25 0.3 0.4 0.45 0.5 0.6 0.8 1.0]

#define OPENDRT_C_BRL_ENABLE    1     // [0 1]
#define OPENDRT_C_BRL           0.0   // [-4.0 -3.0 -2.0 -1.5 -1.0 -0.5 0.0 0.5 1.0]
#define OPENDRT_C_BRL_R         -2.5  // [-5.0 -4.5 -4.0 -3.0 -2.5 -2.0 -1.5 -1.25 -1.0 -0.5 0.0 0.5 1.0]
#define OPENDRT_C_BRL_G         -1.5  // [-5.0 -4.5 -4.0 -3.0 -2.5 -2.0 -1.5 -1.25 -1.0 -0.5 0.0 0.5 1.0]
#define OPENDRT_C_BRL_B         -1.5  // [-5.0 -4.5 -4.0 -3.0 -2.5 -2.0 -1.5 -1.25 -1.0 -0.5 0.0 0.5 1.0]
#define OPENDRT_C_BRL_RNG       0.5   // [0.1 0.25 0.3 0.35 0.5 0.8 1.0]
#define OPENDRT_C_BRL_ST        0.35  // [0.1 0.15 0.25 0.3 0.35 0.5 0.75 1.0]

#define OPENDRT_C_BRLP_ENABLE   1     // [0 1]
#define OPENDRT_C_BRLP          -0.5  // [-2.0 -1.5 -1.0 -0.5 0.0 0.5 1.0]
#define OPENDRT_C_BRLP_R        -1.25 // [-2.0 -1.7 -1.5 -1.25 -1.0 -0.5 -0.25 0.0 0.5]
#define OPENDRT_C_BRLP_G        -1.25 // [-2.0 -1.7 -1.5 -1.25 -1.0 -0.5 -0.25 0.0 0.5]
#define OPENDRT_C_BRLP_B        -0.25 // [-2.0 -1.7 -1.5 -1.25 -1.0 -0.5 -0.25 0.0 0.5]

#define OPENDRT_C_HC_ENABLE     1     // [0 1]
#define OPENDRT_C_HC_R          1.0   // [0.0 0.25 0.5 0.75 1.0 1.25 1.5 2.0]
#define OPENDRT_C_HC_R_RNG      0.3   // [0.1 0.2 0.25 0.3 0.35 0.4 0.5 0.75 1.0]

#define OPENDRT_C_HS_RGB_ENABLE 1     // [0 1]
#define OPENDRT_C_HS_R          0.6   // [0.0 0.25 0.35 0.5 0.6 0.66 0.7 0.75 0.8 0.85 1.0]
#define OPENDRT_C_HS_G          0.35  // [0.0 0.25 0.35 0.5 0.6 0.66 0.7 0.75 0.8 0.85 1.0]
#define OPENDRT_C_HS_B          0.66  // [0.0 0.25 0.35 0.5 0.6 0.66 0.7 0.75 0.8 0.85 1.0]
#define OPENDRT_C_HS_R_RNG      0.6   // [0.25 0.5 0.6 0.8 1.0 1.15 1.25 1.33 1.5 2.0]
#define OPENDRT_C_HS_G_RNG      1.0   // [0.25 0.5 0.6 0.8 1.0 1.15 1.25 1.33 1.5 2.0]
#define OPENDRT_C_HS_B_RNG      1.0   // [0.25 0.5 0.6 0.8 1.0 1.15 1.25 1.33 1.5 2.0]

#define OPENDRT_C_HS_CMY_ENABLE 1     // [0 1]
#define OPENDRT_C_HS_C          0.25  // [0.0 0.15 0.25 0.35 0.5 0.66 0.75 1.0]
#define OPENDRT_C_HS_M          0.0   // [0.0 0.15 0.25 0.35 0.5 0.66 0.75 1.0]
#define OPENDRT_C_HS_Y          0.0   // [0.0 0.15 0.25 0.35 0.5 0.66 0.75 1.0]
#define OPENDRT_C_HS_C_RNG      1.0   // [0.25 0.5 0.66 0.765 1.0 1.5 2.0]
#define OPENDRT_C_HS_M_RNG      1.0   // [0.25 0.5 0.66 0.765 1.0 1.5 2.0]
#define OPENDRT_C_HS_Y_RNG      1.0   // [0.25 0.5 0.66 0.765 1.0 1.5 2.0]

OpenDRTParams opendrt_preset_custom() {
    OpenDRTParams p = opendrt_preset_default(); // tonescale tetap Standard

    p.cwp = OPENDRT_C_CWP; p.cwp_lm = OPENDRT_C_CWP_LIMIT;
    p.rs_sa = OPENDRT_C_RS_STRENGTH; p.rs_rw = OPENDRT_C_RS_RED_W; p.rs_bw = OPENDRT_C_RS_BLUE_W;

    p.pt_lml = OPENDRT_C_PT_LOW;
    p.pt_lml_rgb = vec3(OPENDRT_C_PT_LOW_R, OPENDRT_C_PT_LOW_G, OPENDRT_C_PT_LOW_B);
    p.pt_lmh = OPENDRT_C_PT_HIGH; p.pt_lmh_r = OPENDRT_C_PT_HIGH_R; p.pt_lmh_b = OPENDRT_C_PT_HIGH_B;

    p.ptl_enable = OPENDRT_C_PTL_ENABLE == 1;
    p.ptl_c = OPENDRT_C_PTL_C; p.ptl_m = OPENDRT_C_PTL_M; p.ptl_y = OPENDRT_C_PTL_Y;

    p.ptm_enable = OPENDRT_C_PTM_ENABLE == 1;
    p.ptm_low  = OPENDRT_C_PTM_LOW;  p.ptm_low_rng  = OPENDRT_C_PTM_LOW_RNG;  p.ptm_low_st  = OPENDRT_C_PTM_LOW_ST;
    p.ptm_high = OPENDRT_C_PTM_HIGH; p.ptm_high_rng = OPENDRT_C_PTM_HIGH_RNG; p.ptm_high_st = OPENDRT_C_PTM_HIGH_ST;

    p.brl_enable = OPENDRT_C_BRL_ENABLE == 1;
    p.brl = OPENDRT_C_BRL; p.brl_rgb = vec3(OPENDRT_C_BRL_R, OPENDRT_C_BRL_G, OPENDRT_C_BRL_B);
    p.brl_rng = OPENDRT_C_BRL_RNG; p.brl_st = OPENDRT_C_BRL_ST;

    p.brlp_enable = OPENDRT_C_BRLP_ENABLE == 1;
    p.brlp = OPENDRT_C_BRLP; p.brlp_rgb = vec3(OPENDRT_C_BRLP_R, OPENDRT_C_BRLP_G, OPENDRT_C_BRLP_B);

    p.hc_enable = OPENDRT_C_HC_ENABLE == 1;
    p.hc_r = OPENDRT_C_HC_R; p.hc_r_rng = OPENDRT_C_HC_R_RNG;

    p.hs_rgb_enable = OPENDRT_C_HS_RGB_ENABLE == 1;
    p.hs_rgb     = vec3(OPENDRT_C_HS_R, OPENDRT_C_HS_G, OPENDRT_C_HS_B);
    p.hs_rgb_rng = vec3(OPENDRT_C_HS_R_RNG, OPENDRT_C_HS_G_RNG, OPENDRT_C_HS_B_RNG);

    p.hs_cmy_enable = OPENDRT_C_HS_CMY_ENABLE == 1;
    p.hs_cmy     = vec3(OPENDRT_C_HS_C, OPENDRT_C_HS_M, OPENDRT_C_HS_Y);
    p.hs_cmy_rng = vec3(OPENDRT_C_HS_C_RNG, OPENDRT_C_HS_M_RNG, OPENDRT_C_HS_Y_RNG);

    return p;
}

void opendrt_tonescale_custom(inout OpenDRTParams p) {
    p.tn_con = OPENDRT_C_CONTRAST; 
p.tn_sh = OPENDRT_C_SHOULDER;
    p.tn_toe = OPENDRT_C_TOE;      
p.tn_off = OPENDRT_C_OFFSET;
    p.tn_su = OPENDRT_C_SURROUND;
    p.tn_hcon_enable = OPENDRT_C_HCON_ENABLE == 1;
    p.tn_hcon = OPENDRT_C_HCON; p.tn_hcon_pv = OPENDRT_C_HCON_PIVOT; 
p.tn_hcon_st = OPENDRT_C_HCON_START;
    p.tn_lcon_enable = OPENDRT_C_LCON_ENABLE == 1;
    p.tn_lcon = OPENDRT_C_LCON; 
p.tn_lcon_w = OPENDRT_C_LCON_WIDTH;
}

vec3 OpenDRT(vec3 color) {
    // Revelation working space (linear Rec.2020) -> linear Rec.709 (OpenDRT input)
    color = color * Rec2020_2_sRGB;

    OpenDRTParams opendrt_params = OPENDRT_PRESET();
    OPENDRT_TONESCALE_PRESET(opendrt_params);
    opendrt_params.tn_Lg = OPENDRT_MIDDLE_GREY;

    // For granular control, uncomment and edit (same as itrp patch):
    // opendrt_params.tn_Lp = 100.0;
    // opendrt_params.tn_gb = 0.13;
    // opendrt_params.pt_hdr = 0.5;
    // opendrt_params.tn_con = 1.4;
    // opendrt_params.tn_sh = 0.5;
    // opendrt_params.tn_toe = 0.0;
    // opendrt_params.tn_off = 0.0;
    // opendrt_params.tn_hcon_enable = false; opendrt_params.tn_hcon = 0.0; opendrt_params.tn_hcon_pv = 1.0; opendrt_params.tn_hcon_st = 4.0;
    // opendrt_params.tn_lcon_enable = true; opendrt_params.tn_lcon = 0.4; opendrt_params.tn_lcon_w = 0.5;
    // opendrt_params.rs_sa = 0.35; opendrt_params.rs_rw = 0.25; opendrt_params.rs_bw = 0.55;
    // opendrt_params.tn_su = 1;

    color = opendrt_transform(color, opendrt_params);

    // Back to Rec.2020; the Rec2020_2_sRGB in main() returns it to Rec.709
    return color * sRGB_2_Rec2020;
}

#ifdef HDR_ENABLED
	#define REAL_TONE_MAPPER HDR_TONE_MAPPER
#else
	#define REAL_TONE_MAPPER TONE_MAPPER
#endif

#if REAL_TONE_MAPPER == 1
	#define TONEMAPPING_FN AgX_Minimal
#elif REAL_TONE_MAPPER == 2
	#define TONEMAPPING_FN AgX_Full
#elif REAL_TONE_MAPPER == 3
    #define TONEMAPPING_FN AgX_AllenWp
#elif REAL_TONE_MAPPER == 16
	#define TONEMAPPING_FN AcademyFit
#elif REAL_TONE_MAPPER == 17
	#define TONEMAPPING_FN ACES2
#elif REAL_TONE_MAPPER == 32
	#define TONEMAPPING_FN GT
#elif REAL_TONE_MAPPER == 33
	#define TONEMAPPING_FN GT7
#elif REAL_TONE_MAPPER == 48
	#define TONEMAPPING_FN Lottes
#elif REAL_TONE_MAPPER == 64
	#define TONEMAPPING_FN OpenDRT
#else
	#define TONEMAPPING_FN None
#endif

//======// Main //================================================================================//
void main() {
    // When super resolution is enabled, texelPos will be at the original resolution
	ivec2 texelPos = ivec2(gl_FragCoord.xy);
    vec2 screenCoord = texelToUv(texelPos);

	#if EXPOSURE_MODE == MANUAL
		float exposure = exp2(-MANUAL_EV);
	#else
		float exposure = exposure.value;
	#endif

    #ifdef MOTION_BLUR
        color = texelFetch(colortex0, texelPos, 0).rgb;
    #else
        color = texelFetch(colortex1, texelPos, 0).rgb;
    #endif

	// Bloom and fog
	#ifdef BLOOM
		CombineBloomAndFog(color, screenCoord, exposure);
	#endif

	// Debug sky environment map
	#ifdef DEBUG_SKY_MAP
		if (all(lessThan(texelPos, textureSize(skyEnvMapTex, 0)))) {
			color = texelFetch(skyEnvMapTex, texelPos, 0).rgb;
		}
	#endif

	#ifdef DEBUG_ATMOSPHERE_LUTS
		ivec2 tempTexel = texelPos;
		if (all(lessThan(tempTexel, textureSize(skyViewTex, 0)))) {
			color = DecodeRGBE8(texelFetch(skyViewTex, tempTexel, 0));
		}
		tempTexel.x -= textureSize(skyViewTex, 0).x;
		if (clamp(tempTexel, ivec2(0), textureSize(tLutTex, 0) - 1) == tempTexel) {
			color = texelFetch(tLutTex, tempTexel, 0).rgb * 64.0;
		}
		tempTexel.x -= textureSize(tLutTex, 0).x;
		if (clamp(tempTexel, ivec2(0), textureSize(msLutTex, 0) - 1) == tempTexel) {
			color = texelFetch(msLutTex, tempTexel, 0).rgb * 512.0;
		}
	#endif

	// Apply exposure
	color *= exposure;

	// Purkinje shift
	#ifdef PURKINJE_SHIFT
		float mesopicFactor = MesopicAdaptation(exposure);
		color = ScotopicVision(color, mesopicFactor);
	#endif

	// Vignetting
	#ifdef VIGNETTE_ENABLED
        vec2 ndcCoord = screenCoord * 2.0 - 1.0;
		ndcCoord.x *= mix(1.0, aspectRatio, VIGNETTE_ROUNDNESS);
		color *= exp2(-0.5 * VIGNETTE_STRENGTH * sdot(ndcCoord));
	#endif

    // Tone mapping
    color = TONEMAPPING_FN(color);

    // Contrast
    #if COLOR_CONTRAST != 100
        const float contrast = COLOR_CONTRAST / 100.0;
        float luminanceIn = luminance(color);
        float luminanceOut = max0(contrast * (luminanceIn - 0.18) + 0.18);
        color *= luminanceOut / maxEps(luminanceIn);
    #endif

    // Saturation
    #if COLOR_SATURATION != 100
        const float saturation = COLOR_SATURATION / 100.0;
        color = max0(mix(vec3(luminance(color)), color, saturation));
    #endif

        #ifndef HDR_ENABLED
        // Working to display space
        color *= Rec2020_2_sRGB;

        #if REAL_TONE_MAPPER == 64
            // Same as itrp patch: OpenDRT output encoded with sRGB OETF
            color = linearToSRGB(saturate(color));
        #else
            // Gamma correction
            color = saturate(pow(color, vec3(1.0 / GAMMA_CORRECTION)));
        #endif
    #else
    
        // Limited in Rec2020 non negative linear value range for CAS
        color = max0(color);
    #endif

	// Debug tone mapping plot
	#ifdef DEBUG_TONE_MAPPING_PLOT
		const float scale = 1.5;

        vec2 uv = screenCoord * vec2(aspectRatio, 1.0) * scale;
        float plot = smoothstep(0.0, scale * scaledPixelSize.y, abs(screenCoord.y - TONEMAPPING_FN(vec3(uv.x)).x));

		// Show LDR range
		color = vec3(0.25) * step(uv.x, 1.0);
		color = mix(vec3(1.0), color, plot);
	#endif
}
