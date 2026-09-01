export interface ModelType {
  _id: string;
  name: string;
  categoryId: string;
  thumbnails: string;
  modelFileUrl: string;
  description: string;
  hardware: string;
  type: number;
  dimensions: number[];
  isPazlSupplied: boolean;
}

export enum MODEL_TYPES {
  ITEM = 0,
  FLOOR_UNIT = 1,
  WALL_UNIT = 2,
  IN_WALL_UNIT = 3,
  IN_WALL_FLOOR_UNIT = 7,
}

export class Model {
  _id: string;
  name: string;
  categoryId: string;
  thumbnails: string;
  modelFileUrl: string;
  description: string;
  hardware: string;
  type: number;
  dimensions: number[];
  isPazlSupplied: boolean;

  constructor(props: ModelType) {
    this._id = props._id;
    this.name = props.name;
    this.categoryId = props.categoryId;
    this.thumbnails = props.thumbnails;
    this.modelFileUrl = props.modelFileUrl;
    this.description = props.description;
    this.hardware = props.hardware;
    this.type = props.type;
    this.dimensions = props.dimensions;
    this.isPazlSupplied = props.isPazlSupplied;
  }
}
