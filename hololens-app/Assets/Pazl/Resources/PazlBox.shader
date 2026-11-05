// A plain lit colour, for a unit shown as a box of its size when its model
// could not be loaded. Single-pass instanced, for HoloLens' two eyes.
Shader "Pazl/Box"
{
    Properties
    {
        _Color ("Colour", Color) = (0.78, 0.62, 0.42, 1)
    }
    SubShader
    {
        Tags { "Queue" = "Geometry" "RenderType" = "Opaque" }
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"

            fixed4 _Color;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float shade : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert(appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                // Light from above and in front, so the faces read apart.
                float3 n = normalize(UnityObjectToWorldNormal(v.normal));
                o.shade = 0.55 + 0.45 * saturate(dot(n, normalize(float3(0.3, 0.8, 0.5))));
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                return fixed4(_Color.rgb * i.shade, 1);
            }
            ENDCG
        }
    }
}
