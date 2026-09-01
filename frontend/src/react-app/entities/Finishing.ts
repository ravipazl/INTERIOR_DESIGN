import { Texture } from "@pazl/entities/Texture";

export interface FinishingBrand {
  _id: string;
  name: string;
}

export interface FinishingType {
  _id: string;
  name: string;
  type: string;
  category: any;
  categoryId: string;
  textureId: string;
  texture: Texture;
  finish_texture: string[];
  brandIds: string[];
  brands: FinishingBrand[];
}

export class Finishing {
  _id: string;
  name: string;
  type: string;
  category: any;
  categoryId: string;
  textureId: string;
  texture: Texture;
  finish_texture: string[];
  brandIds: string[];
  brands: FinishingBrand[];

  constructor(props: FinishingType) {
    this._id = props._id;
    this.name = props.name;
    this.type = props.type;
    this.category = props.category;
    this.categoryId = props.categoryId;
    this.textureId = props.textureId;
    this.texture = props.texture;
    this.finish_texture = props.finish_texture;
    this.brandIds = props.brandIds;
    this.brands = props.brands;
  }
}
