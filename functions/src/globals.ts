import * as admin from "firebase-admin";
import {db} from "./index";
import * as dateformat from 'dateformat'
import {HLHorseManagerModel, HLHorseManagerPaymentApproverModel, HLUserModel} from "./models/users";
import {HLHorseModel, HLHorseOwnerModel} from "./models/horses";
import {
    APPLICATION_FEE,
    COLLECTION_HORSE_OWNERS,
    COLLECTION_HORSES,
    COLLECTION_PAYMENT_APPROVERS,
    COLLECTION_SERVICE_REQUESTS,
    COLLECTION_SERVICE_SHOWS,
    COLLECTION_USERS
} from "./constants";
import {HLServiceRequestModel, HLServiceShowModel} from "./models/service-requests";
import {HLInvoiceModel} from "./models/invoices";

const messaging = admin.messaging();

export async function fetchUser(userId: string) {
    try {
        const docUser = await db.collection(COLLECTION_USERS).doc(userId).get();
        if (docUser.exists) {
            return new HLUserModel(docUser.id, docUser.data());
        }
    } catch (err) {
        console.error(err);
    }

    return null;
}

export async function updateHorseDetailInformation(objHorse: HLHorseModel) {
    try {
        // trainer
        if (!objHorse.trainer) {
            const objTrainer = await fetchUser(objHorse.trainerId);
            if (null !== objTrainer) {
                objHorse.trainer = objTrainer.horseManager;
            }
        }

        // creator
        if (!objHorse.creator) {
            const objCreator = await fetchUser(objHorse.creatorId);
            if (null !== objCreator) {
                objHorse.creator = objCreator.horseManager;
            }
        }

        // leaser
        if (objHorse.leaserId && undefined === objHorse.leaser) {
            const objLeaser = await fetchUser(objHorse.leaserId);
            if (null !== objLeaser) {
                objHorse.leaser = objLeaser.horseManager;
            }
        }

        // owners
        if (objHorse.ownerIds && 0 < objHorse.ownerIds.length && undefined === objHorse.owners) {
            const objHorseOwners: HLHorseOwnerModel[] = [];

            const promises: Promise<admin.firestore.QuerySnapshot>[] = [];
            objHorse.ownerIds.forEach(ownerId => {
                promises.push(db.collection(COLLECTION_HORSE_OWNERS)
                    .where('horseId', '==', objHorse.uid)
                    .where('userId', '==', ownerId)
                    .get());
            });

            const aryDocHorseOwners = await Promise.all(promises);
            aryDocHorseOwners.forEach(docHorseOwners => {
                if (0 < docHorseOwners.docs.length) {
                    const docHorseOwner = docHorseOwners.docs[0];
                    const objHorseOwner = new HLHorseOwnerModel(docHorseOwner.id, docHorseOwner.data());
                    objHorseOwners.push(objHorseOwner);
                }
            });

            if (0 < objHorseOwners.length) {
                objHorse.owners = objHorseOwners
            }
        }
    } catch (err) {
        console.error(err);
    }

    return objHorse;
}

export async function updateServiceRequestInformation(objServiceRequest: HLServiceRequestModel, objServiceRequest1: HLServiceRequestModel | undefined = undefined) {
    const newServiceRequest = objServiceRequest1 || objServiceRequest;

    try {
        // horse
        if (!objServiceRequest.horse) {
            const docHorse = await db.collection(COLLECTION_HORSES).doc(objServiceRequest.horseId).get();
            if (docHorse.exists) {
                const objHorse = await updateHorseDetailInformation(new HLHorseModel(docHorse.id, docHorse.data()));
                objServiceRequest.horse = objHorse;

                // get payer who has responsible to pay 100%
                if (objHorse.leaser) {
                    objServiceRequest.payer = objHorse.leaser;
                } else if (objHorse.owners && 0 < objHorse.owners.length) {
                    objServiceRequest.payer = 1 === objHorse.owners.length ? objHorse.owners[0] : undefined;
                } else {
                    objServiceRequest.payer = objHorse.trainer;
                }
            }
        }
        newServiceRequest.horse = objServiceRequest.horse;

        // show
        if (objServiceRequest.showId && !objServiceRequest.show) {
            const docShow = await db.collection(COLLECTION_SERVICE_SHOWS).doc(objServiceRequest.showId).get();
            if (docShow.exists) {
                objServiceRequest.show = new HLServiceShowModel(docShow.id, docShow.data());
            }
        }
        newServiceRequest.show = objServiceRequest.show;

        // service provider
        if (!objServiceRequest.serviceProvider) {
            const objUser = await fetchUser(objServiceRequest.serviceProviderId);
            if (null !== objUser && objUser.serviceProvider) {
                objServiceRequest.serviceProvider = objUser.serviceProvider;
            }
        }
        newServiceRequest.serviceProvider = objServiceRequest.serviceProvider;

        // assigner
        if (objServiceRequest.assignerId && !objServiceRequest.assigner) {
            const objAssignedUser = await fetchUser(objServiceRequest.assignerId);
            if (null !== objAssignedUser && objAssignedUser.serviceProvider) {
                objServiceRequest.assigner = objAssignedUser.serviceProvider;
            }
        }
        newServiceRequest.assigner = objServiceRequest.assigner;

        // creator
        if (objServiceRequest.creatorId && !objServiceRequest.creator) {
            const objCreator = await fetchUser(objServiceRequest.creatorId);
            if (null !== objCreator && objCreator.horseManager) {
                objServiceRequest.creator = objCreator.horseManager;
            }
        }
        newServiceRequest.creator = objServiceRequest.creator;
    } catch (err) {
        console.error(err);
    }

    return newServiceRequest;
}

export async function updateInvoiceInformation(objInvoice: HLInvoiceModel) {
    try {
        // requests
        objInvoice.requests = [];
        for (const requestId of objInvoice.requestIds) {
            const docServiceRequest = await db.collection(COLLECTION_SERVICE_REQUESTS).doc(requestId).get();
            if (!docServiceRequest.exists) continue;

            const objServiceRequest = new HLServiceRequestModel(docServiceRequest.id, docServiceRequest.data());
            const sameHorseRequest = objInvoice.requests.find(value => {
                return value.horseId === objServiceRequest.horseId;
            });
            if (sameHorseRequest) {
                const objUpdatedServiceRequest = await updateServiceRequestInformation(sameHorseRequest, objServiceRequest);
                objInvoice.requests.push(objUpdatedServiceRequest);
            } else {
                const objUpdatedServiceRequest = await updateServiceRequestInformation(objServiceRequest);
                objInvoice.requests.push(objUpdatedServiceRequest);
            }
        }

        // amount
        objInvoice.amount = 0;
        objInvoice.requests.forEach(objRequest => {
            objRequest.services.forEach(objService => {
                objInvoice.amount += objService.rate * (objService.quantity || 1);
            });
        });

        // payers
        objInvoice.payers = [];
        for (const objRequest of objInvoice.requests) {
            if (!objRequest.horse) continue;

            if (objRequest.horse.leaser) {
                if (!hasSameHorseManager(objRequest.horse.leaser.userId, objInvoice.payers)) {
                    objRequest.horse.leaser.percentage = 100;
                    objInvoice.payers.push(objRequest.horse.leaser);
                }
            } else if (objRequest.horse.owners && 0 < objRequest.horse.owners.length) {
                for (const objOwner of objRequest.horse.owners) {
                    if (hasSameHorseManager(objOwner.userId, objInvoice.payers)) continue;
                    objInvoice.payers.push(objOwner);
                }
            } else if (objRequest.horse.trainer) {
                if (!hasSameHorseManager(objRequest.horse.trainer.userId, objInvoice.payers)) {
                    objRequest.horse.trainer.percentage = 100;
                    objInvoice.payers.push(objRequest.horse.trainer)
                }
            }
        }

        // payment approvers
        objInvoice.paymentApprovers = [];
        for (const objPayer of objInvoice.payers) {
            const docPaymentApprovers = await db.collection(COLLECTION_PAYMENT_APPROVERS).where('creatorId', '==', objPayer.userId).get();
            for (const docPaymentApprover of docPaymentApprovers.docs) {
                const objPaymentApprover = new HLHorseManagerPaymentApproverModel(docPaymentApprover.id, docPaymentApprover.data());
                if (-1 === objInvoice.paymentApprovers.findIndex(value => {
                    return value.userId === objPaymentApprover.userId;
                })) {
                    objInvoice.paymentApprovers.push(objPaymentApprover);
                }
            }
        }
    } catch (err) {
        console.error(err);
    }

    return objInvoice;
}

function hasSameHorseManager(userId: string, aryHorseManagers: HLHorseManagerModel[]) {
    return -1 < aryHorseManagers.findIndex(value => {
        return value.userId === userId;
    });
}

export function makeCSVStringWithInvoices(aryInvoices: HLInvoiceModel[]) {
    // create csv header
    let csv = 'Name, Status, Amount, Tip, Invoice Date, Paid Date, Service Providers, Payers\r\n';
    const aryRows: string[] = [];
    for (const objInvoice of aryInvoices) {
        const row = `${objInvoice.name}, 
        ${objInvoice.status.toUpperCase()}, 
        $${objInvoice.amount.toFixed(2)}, 
        $${objInvoice.tip.toFixed(2)}, 
        ${dateformat(objInvoice.createdAt, 'mmm dS, yyyy')},
        ${objInvoice.paidAt ? dateformat(objInvoice.paidAt, 'mmm dS, yyyy') : 'Not Paid Yet'},
        ${getServiceProviders(objInvoice)},
        ${getPayers(objInvoice)}`;

        aryRows.push(row);
    }

    if (0 < aryRows.length) {
        csv += aryRows.join('\r\n');
    }

    return csv;
}

function getServiceProviders(objInvoice: HLInvoiceModel) {
    const aryServiceProviderNames: string[] = [];
    if (objInvoice.requests) {
        for (const objServiceRequest of objInvoice.requests) {
            if (!objServiceRequest.serviceProvider) continue;
            aryServiceProviderNames.push(objServiceRequest.serviceProvider.name);
        }
    }

    return aryServiceProviderNames.join(';');
}

function getPayers(objInvoice: HLInvoiceModel) {
    const aryPayerNames: string[] = [];
    if (objInvoice.payers) {
        for (const objPayer of objInvoice.payers) {
            aryPayerNames.push(objPayer.name);
        }
    }

    return aryPayerNames.join(';');
}

export function isSameDay(date1: Date, date2: Date) {
    return date1.getFullYear() === date2.getFullYear()
        && date1.getMonth() === date2.getMonth()
        && date1.getDay() === date2.getDay();
}

export async function sendPushNotification(payload: admin.messaging.MessagingPayload, toUserIds: string[]) {
    const tokens: string[] = [];

    try {
        const promises: Promise<admin.firestore.DocumentSnapshot>[] = [];
        toUserIds.forEach(userId => {
            promises.push(db.collection(COLLECTION_USERS).doc(userId).get());
        });

        const docUsers = await Promise.all(promises);
        const aryUsers = docUsers.map(docUser => new HLUserModel(docUser.id, docUser.data()));
        for (const objUser of aryUsers) {
            if (objUser.token
                && 0 < objUser.token.length) {
                tokens.push(objUser.token);
            }
        }
        if (0 < tokens.length) {
            return messaging.sendToDevice(tokens, payload);
        }
    } catch (err) {
        console.error(err);
    }

    return null;
}

export function getAmountWithApplicationFee(amount: number) {
    return amount * (1 + APPLICATION_FEE / 100);
}

export function queryLimit(limit: number) {
    return limit * 2;
}

// export function sendEmail(toUserIds: string[]) {
//     const emails: string[] = [];
//
//     const promises: Promise<admin.firestore.DocumentSnapshot>[] = [];
//     toUserIds.forEach(userId => {
//         promises.push(db.collection(COLLECTION_USERS).doc(userId).get());
//     });
//
//     return Promise.all(promises).then(aryDocUsers => {
//         aryDocUsers.forEach(docUser => {
//             const objUser = new HLUserModel(docUser.id, docUser.data());
//             emails.push(objUser.email);
//         });
//
//         if (0 < emails.length) {
//             return ;
//         }
//
//         return Promise.reject();
//     }).catch(err => Promise.reject(err));
// }