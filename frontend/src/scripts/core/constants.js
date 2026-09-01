import Enum from "es6-enum";

/** Dimensioning in Inch. */
export const dimInch = "inch";

/** Dimensioning in Inch. */
export const dimFeetAndInch = "feetAndInch";

/** Dimensioning in Meter. */
export const dimMeter = "m";

/** Dimensioning in Centi Meter. */
export const dimCentiMeter = "cm";

/** Dimensioning in Milli Meter. */
export const dimMilliMeter = "mm";

export const VIEW_TOP = "topview";
export const VIEW_FRONT = "frontview";
export const VIEW_RIGHT = "rightview";
export const VIEW_LEFT = "leftview";
export const VIEW_ISOMETRY = "isometryview";

export const WallTypes = Enum("STRAIGHT", "CURVED");

export const TEXTURE_DEFAULT_REPEAT = 300;

export const defaultWallTexture = {
  color: "#FFFFFF",
  name: "Solid",
  colormap:
    "/assets/rooms/textures/library/solids/21051.jpg",
  reflective: 0.5,
  shininess: 0.5,
};

export const defaultWallTexture2 = {
  color: "#FFFFFF",
  name: "Solid",
  colormap:
    "/assets/rooms/textures/library/solids/21321.jpg",
  reflective: 0.5,
  shininess: 0.5,
};

//export const defaultFloorTexture = { color: '#FFFFFF', emissive: '#181818', repeat: TEXTURE_DEFAULT_REPEAT, ambientmap: 'textures/Floor/Marble_Tiles_001/Marble_Tiles_001_ambientOcclusion.jpg', colormap: 'textures/Floor/Marble_Tiles_001/Marble_Tiles_001_basecolor.jpg', roughnessmap: 'textures/Floor/Marble_Tiles_001/Marble_Tiles_001_roughness.jpg', normalmap: 'textures/Floor/Marble_Tiles_001/Marble_Tiles_001_normal.jpg' };
/*export const defaultFloorTexture = {
    name: "Marble_White_007_SD",
    reflective: 0.1,
    ambientmap: "textures/Floor/Marble_White_007_SD/Marble_White_007_ambientOcclusion.jpg",
    bumpmap: "textures/Floor/Marble_White_007_SD/Marble_White_007_height.png",
    normalmap: "textures/Floor/Marble_White_007_SD/Marble_White_007_normal.jpg",
    colormap: "textures/Floor/Marble_White_007_SD/Marble_White_007_basecolor.jpg",
    roughnessmap: "textures/Floor/Marble_White_007_SD/Marble_White_007_roughness.jpg"
};*/

export const defaultFloorTexture = {
  color: "#FFFFFF",
  name: "Solid",
  colormap: "/assets/models/textures/10159.jpg",
};

export const TEXTURE_PROPERTY_COLOR = "color";
export const TEXTURE_NO_PREVIEW = "textures/NoPreview.jpg";
export const STORAGE_KEY = "blueprint";
export const MODEL_LIST = "modellists";
export const TEXTURE_LIST = "textures";
