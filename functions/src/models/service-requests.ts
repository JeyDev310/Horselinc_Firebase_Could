import {HLHorseManagerModel, HLListenerUserModel, HLServiceProviderModel, HLServiceProviderServiceModel} from "./users";
import {HLServiceRequestStatus} from "../enumerations";
import {HLHorseModel} from "./horses";

export class HLServiceRequestModel {
    uid: string;
    horseId: string;
    horseBarnName: string;
    horseDisplayName: string;
    horse?: HLHorseModel;   // no need to upload
    showId?: string;
    show?: HLServiceShowModel;
    competitionClass?: string;
    serviceProviderId: string;
    serviceProvider?: HLServiceProviderModel;   // no need to upload
    assignerId?: string;
    assigner?: HLServiceProviderModel;  // no need to upload
    services: HLServiceProviderServiceModel[];
    payer?: HLHorseManagerModel;    // no need to upload
    instruction?: string;
    providerNote?: string;
    status: HLServiceRequestStatus;

    // custom invoice
    isCustomRequest?: boolean;
    // dismissed ids
    dismissedBy?: string[];

    listenerUsers?: HLListenerUserModel[];

    creatorId: string;
    creator?: HLHorseManagerModel;

    requestDate: Date;
    createdAt: Date;
    updatedAt: Date;

    constructor(uid: string, data: any) {
        this.uid = uid;
        this.horseId = data.horseId;
        this.horseBarnName = data.horseBarnName;
        this.horseDisplayName = data.horseDisplayName;
        this.showId = data.showId;
        this.competitionClass = data.competitionClass;
        this.serviceProviderId = data.serviceProviderId;
        this.assignerId = data.assignerId;
        this.services = data.services.map((value: any) => new HLServiceProviderServiceModel(value.uid, value));
        this.instruction = data.instruction;
        this.providerNote = data.providerNote;
        this.status = data.status || HLServiceRequestStatus.pending;

        this.isCustomRequest = data.isCustomRequest || false;
        this.dismissedBy = data.dismissedBy;

        this.listenerUsers = data.listenerUsers;

        this.creatorId = data.creatorId;
        this.requestDate = new Date(data.requestDate);
        if (data.createdAt) {
            this.createdAt = new Date(data.createdAt);
        } else {
            this.createdAt = new Date();
        }
        if (data.updatedAt) {
            this.updatedAt = new Date(data.updatedAt);
        } else {
            this.updatedAt = new Date();
        }
    }

    toJSON(): {} {
        const dicObject = Object.assign({}, this, {
            horse: this.horse ? this.horse.toJSON() : undefined,
            show: this.show ? this.show.toJSON() : undefined,
            serviceProvider: this.serviceProvider ? this.serviceProvider.toJSON(false) : undefined,
            assigner: this.assigner ? this.assigner.toJSON(false) : undefined,
            services: this.services.map(value => value.toJSON()),
            payer: this.payer ? this.payer.toJSON(false) : undefined,
            creator: this.creator ? this.creator.toJSON(false) : undefined,
            listenerUsers: this.listenerUsers ? this.listenerUsers.map(value => value.toJSON()) : undefined,
            requestDate: this.requestDate.getTime(),
            createdAt: this.createdAt.getTime(),
            updatedAt: this.updatedAt.getTime()
        });
        return JSON.parse(JSON.stringify(dicObject));
    }

    totalAmount() {
        let totalAmount = 0;
        this.services.forEach(service => {
            totalAmount += service.rate * (service.quantity || 1);
        });
        return totalAmount;
    }
}

export class HLServiceShowModel {
    uid: string;
    name: string;
    createdAt: Date;

    constructor(uid: string, data: any) {
        this.uid = uid;
        this.name = data.name;
        if (data.createdAt) {
            this.createdAt = new Date(data.createdAt);
        } else {
            this.createdAt = new Date();
        }
    }

    toJSON(): {} {
        const dicObject = Object.assign({}, this, {
            createdAt: this.createdAt.getTime()
        });
        return JSON.parse(JSON.stringify(dicObject));
    }
}