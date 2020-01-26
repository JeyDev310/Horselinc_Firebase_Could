import {HLServiceRequestModel} from "./service-requests";
import {HLInvoiceStatus} from "../enumerations";
import {HLHorseManagerModel, HLHorseManagerPaymentApproverModel, HLListenerUserModel} from "./users";

export class HLInvoiceModel {
    uid: string;
    name: string;
    requestIds: string[];
    requests?: HLServiceRequestModel[]; // no need to upload
    payers?: HLHorseManagerModel[]; // no need to upload
    paymentApprovers?: HLHorseManagerPaymentApproverModel[]; // no need to upload
    amount: number; // no need to upload
    tip: number;
    status: HLInvoiceStatus;

    listenerUsers?: HLListenerUserModel[];

    paidAt?: Date;
    createdAt: Date;

    constructor(uid: string, data: any) {
        this.uid = uid;
        this.name = data.name;
        this.requestIds = data.requestIds;
        this.amount = data.amount;
        this.tip = data.tip;
        this.status = data.status;

        this.listenerUsers = data.listenerUsers;

        if (data.paidAt) {
            this.paidAt = new Date(data.paidAt);
        }
        if (data.createdAt) {
            this.createdAt = new Date(data.createdAt);
        } else {
            this.createdAt = new Date();
        }
    }

    toJSON() {
        const dicObject = Object.assign({}, this, {
            requests: this.requests ? this.requests.map(value => value.toJSON()) : undefined,
            payers: this.payers ? this.payers.map(value => value.toJSON()) : undefined,
            paymentApprovers: this.paymentApprovers ? this.paymentApprovers.map(value => value.toJSON()) : undefined,
            listenerUsers: this.listenerUsers ? this.listenerUsers.map(value => value.toJSON()) : undefined,
            paidAt: this.paidAt ? this.paidAt.getTime() : undefined,
            createdAt: this.createdAt.getTime()
        });
        return JSON.parse(JSON.stringify(dicObject));
    }
}