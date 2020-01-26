import {HLHorseGenderType} from "../enumerations";
import {HLHorseManagerModel} from "./users";

export class HLHorseOwnerModel extends HLHorseManagerModel {
    uid: string;
    horseId: string;

    constructor(uid: string, data: any) {
        super(data);
        this.uid = uid;
        this.horseId = data.horseId;
    }

    toJSON(): {} {
        const dicObject = Object.assign({}, this, {
            createdAt: this.createdAt.getTime()
        });
        return JSON.parse(JSON.stringify(dicObject));
    }
}

interface HLHorseRegistrationInterface {
    name: string;
    number: number;
}

export class HLHorseModel {
    uid: string;
    avatarUrl?: string;
    barnName: string;
    displayName: string;
    gender: HLHorseGenderType;
    birthYear?: number;
    trainerId: string;
    trainer?: HLHorseManagerModel;
    creatorId: string;
    creator?: HLHorseManagerModel;
    leaserId?: string;
    leaser?: HLHorseManagerModel;
    owners?: HLHorseOwnerModel[];
    ownerIds?: string[];
    description?: string;
    privateNote?: string;
    color?: string;
    sire?: string;
    dam?: string;
    height?: number;
    registrations?: HLHorseRegistrationInterface[];
    isDeleted: boolean;
    createdAt: Date;

    constructor(uid: string, data: any) {
        this.uid = uid;
        this.avatarUrl = data.avatarUrl;
        this.barnName = data.barnName;
        this.displayName = data.displayName;
        this.gender = data.gender;
        this.birthYear = data.birthYear;
        this.trainerId = data.trainerId;
        this.creatorId = data.creatorId;
        this.leaserId = data.leaserId;
        this.ownerIds = data.ownerIds;
        this.description = data.description;
        this.privateNote = data.privateNote;
        this.color = data.color;
        this.sire = data.sire;
        this.dam = data.dam;
        this.height = data.height;
        this.registrations = data.registrations;
        this.isDeleted = data.isDeleted;
        if (data.createdAt) {
            this.createdAt = new Date(data.createdAt);
        } else {
            this.createdAt = new Date();
        }
    }

    toJSON(): {} {
        const dicObject = Object.assign({}, this, {
            trainer: this.trainer ? this.trainer.toJSON(false) : undefined,
            creator: this.creator ? this.creator.toJSON(false) : undefined,
            leaser: this.leaser ? this.leaser.toJSON(false) : undefined,
            owners: this.owners ? this.owners.map(value => value.toJSON()) : undefined,
            createdAt: this.createdAt.getTime()
        });
        return JSON.parse(JSON.stringify(dicObject));
    }
}