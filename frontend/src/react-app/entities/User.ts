export enum UserPermission {
  SUPER_ADMIN = "super_admin",
  ADMIN = "admin",
  ARCHITECT = "architect",
  USER = "user",
}

export interface UserType {
  _id: string;
  email: string;
  phoneNumber: string;
  name: string;
  creditScore: number;
  googleId: string;
  facebookId: string;
  profilePicture: string;
  permissions: UserPermission;
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  _id: string;
  email: string;
  phoneNumber: string;
  name: string;
  creditScore: number;
  googleId: string;
  facebookId: string;
  profilePicture: string;
  permissions: UserPermission;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: UserType) {
    this._id = props._id;
    this.name = props.name;
    this.email = props.email;
    this.phoneNumber = props.phoneNumber;
    this.permissions = props.permissions;
    this.creditScore = props.creditScore;
    this.googleId = props.googleId;
    this.facebookId = props.facebookId;
    this.profilePicture = props.profilePicture;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
