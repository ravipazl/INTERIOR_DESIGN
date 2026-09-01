export interface TextureCategoryType {
  _id: string;
  name: string;
}

export class TextureCategory {
  _id: string;
  name: string;

  constructor(props: TextureCategoryType) {
    this._id = props._id;
    this.name = props.name;
  }
}
