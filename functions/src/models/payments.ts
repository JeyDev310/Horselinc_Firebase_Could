export class HLPaymentModel {
    uid: string;
    invoiceId: string;
    payerId: string;
    paymentApproverId?: string;
    amount: number;
    tip: number;
    isPaidOutsideApp: boolean;
    createdAt: Date;

    constructor(uid: string, data: any) {
        this.uid = uid;
        this.invoiceId = data.invoiceId;
        this.payerId = data.payerId;
        this.paymentApproverId = data.paymentApproverId;
        this.amount = data.amount;
        this.tip = data.tip || 0;
        this.isPaidOutsideApp = data.isPaidOutsideApp || false;
        if (data.createdAt) {
            this.createdAt = new Date(data.createdAt);
        } else {
            this.createdAt = new Date();
        }
    }
}

export interface HLTransfer {
    userId: string;
    amount: number;
    destination: string;
}