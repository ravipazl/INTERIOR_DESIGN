import { User } from "@pazl/entities/User";

export enum ProjectStatus {
  OPEN = "open",
  QUOTATION_REQUESTED = "quotation_requested",
  QUOTATION_SENT = "quotation_sent",
  CLOSED = "closed",
}

export interface ProjectType {
  _id: string;
  name: string;
  status: ProjectStatus;
  ownerUserId: string;
  ownerUser?: User;
  architectUserId: string;
  architectUser?: User;
  address: string;
  clientName: string;
  shareId: string;
  defaultUnits: string;
  sharedUserIDs: string[];
  sharedUsers: string[];
  boqNumber: string;
  revisedBoqNumber: string;
  clientGSTNumber: string;
  clientEmail: string;
  clientPhoneNumber: string;
  installationCost?: number;
  changeRequestPending?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class Project {
  _id: string;
  name: string;
  status: string;
  ownerUserId: string;
  ownerUser?: User;
  architectUserId: string;
  architectUser?: User;
  address: string;
  clientName: string;
  shareId: string;
  defaultUnits: string;
  sharedUserIDs: string[];
  sharedUsers: string[];
  boqNumber: string;
  revisedBoqNumber: string;
  clientGSTNumber: string;
  clientEmail: string;
  clientPhoneNumber: string;
  installationCost?: number;
  changeRequestPending?: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: ProjectType) {
    this._id = props._id;
    this.name = props.name;
    this.status = props.status;
    this.ownerUserId = props.ownerUserId;
    this.ownerUser = props.ownerUser;
    this.architectUserId = props.architectUserId;
    this.architectUser = props.architectUser;
    this.address = props.address;
    this.clientName = props.clientName;
    this.shareId = props.shareId;
    this.defaultUnits = props.defaultUnits;
    this.sharedUserIDs = props.sharedUserIDs;
    this.sharedUsers = props.sharedUsers;
    this.boqNumber = props.boqNumber;
    this.revisedBoqNumber = props.revisedBoqNumber;
    this.clientGSTNumber = props.clientGSTNumber;
    this.clientEmail = props.clientEmail;
    this.clientPhoneNumber = props.clientPhoneNumber;
    this.installationCost = props.installationCost;
    this.changeRequestPending = props.changeRequestPending;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
