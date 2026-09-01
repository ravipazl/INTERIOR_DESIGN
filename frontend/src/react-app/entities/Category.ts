export interface CategoryType {
  _id: string;
  name: string;
  parentCategoryId: string;
  invisible: boolean;
  thumbnail: string;
}

export class Category {
  _id: string;
  name: string;
  parentCategoryId: string;
  invisible: boolean;
  thumbnail: string;

  constructor(props: CategoryType) {
    this._id = props._id;
    this.name = props.name;
    this.parentCategoryId = props.parentCategoryId;
    this.invisible = props.invisible;
    this.thumbnail = props.thumbnail;
  }
}
