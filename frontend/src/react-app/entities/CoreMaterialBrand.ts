export interface CoreMaterialBrandType {
  _id: string;
  name: string;
}

export class CoreMaterialBrand {
  _id: string;
  name: string;

  constructor(props: CoreMaterialBrandType) {
    this._id = props._id;
    this.name = props.name;
  }
}
