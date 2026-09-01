export interface CoreMaterialTypeType {
  _id: string;
  type: string;
  grades: string;
  imageUrl: string;
}

export class CoreMaterialType {
  _id: string;
  type: string;
  grades: string;
  imageUrl: string;

  constructor(props: CoreMaterialTypeType) {
    this._id = props._id;
    this.type = props.type;
    this.grades = props.grades;
    this.imageUrl = props.imageUrl;
  }
}
