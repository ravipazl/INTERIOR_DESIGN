export interface TextureType {
  _id: string;
  fileUrl: string;
  name: string;
  material: string;
  textureCategoryId: string;
}

export class Texture {
  _id: string;
  fileUrl: string;
  name: string;
  material: string;
  textureCategoryId: string;

  constructor(props: TextureType) {
    this._id = props._id;
    this.fileUrl = props.fileUrl;
    this.name = props.name;
    this.material = props.material;
    this.textureCategoryId = props.textureCategoryId;
  }
}
