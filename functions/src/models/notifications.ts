import {HLBaseUserModel} from "./users";

export class HLNotificationModel {
    uid: string;
    creator: HLBaseUserModel;
    message: string;
    receiverId: string;
    isRead: boolean;

    updatedAt: Date;
    createdAt: Date;

    constructor(uid: string, data: any) {
        this.uid = uid;
        this.creator = new HLBaseUserModel(data.creator);
        this.message = data.messages;
        this.receiverId = data.receiverId;
        this.isRead = data.isRead;
        if (data.updatedAt) {
            this.updatedAt = new Date(data.updatedAt);
        } else {
            this.updatedAt = new Date();
        }
        if (data.createdAt) {
            this.createdAt = new Date(data.createdAt);
        } else {
            this.createdAt = new Date();
        }
    }
}