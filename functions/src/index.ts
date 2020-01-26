import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import * as express from 'express'
import * as cors from 'cors'
import * as session from 'express-session'
import * as dateformat from 'dateformat'
import * as Stripe from 'stripe'

admin.initializeApp();

import * as Stripes from './stripes/index';
import * as APIs from './apis/index';
import * as Global from './globals';

import {
    HLBaseUserModel,
    HLHorseManagerModel,
    HLHorseManagerPaymentApproverModel,
    HLHorseManagerProviderModel, HLListenerUserModel,
    HLServiceProviderModel,
    HLStripeCustomerModel,
    HLUserModel
} from "./models/users";
import {
    COLLECTION_HORSE_MANAGER_PROVIDERS,
    COLLECTION_HORSE_OWNERS,
    COLLECTION_HORSES,
    COLLECTION_INVOICES,
    COLLECTION_NOTIFICATIONS,
    COLLECTION_PAYMENT_APPROVERS,
    COLLECTION_PAYMENTS,
    COLLECTION_SERVICE_REQUESTS,
    COLLECTION_SERVICE_SHOWS,
    COLLECTION_USERS,
    HORSE_SEARCH_LIMIT,
    INVOICE_LIMIT,
    MIN_QUERY_LEN,
    SERVICE_REQUEST_LIMIT,
    SERVICE_SHOW_LIMIT,
    USER_SEARCH_LIMIT
} from "./constants";
import {HLHorseUserSearchType, HLInvoiceStatus, HLServiceRequestStatus, HLUserType} from "./enumerations";
import {HLHorseModel, HLHorseOwnerModel} from "./models/horses";
import {HLServiceRequestModel, HLServiceShowModel} from "./models/service-requests";
import {HLInvoiceModel} from "./models/invoices";
import {HLMessageModel} from "./models/messages";
import {HLPaymentModel, HLTransfer} from "./models/payments";

export const db = admin.firestore();
const storage = admin.storage();
export const FieldValue = admin.firestore.FieldValue;

const app = express();
app.use(cors({ origin: true }));
const FirestoreStore = require('firestore-store')(session);
app.use(session({
    store: new FirestoreStore({ database: db }),
    secret: functions.config().express.secret,
    resave: true,
    saveUninitialized: true
}));

/*
    User Triggers
 */
exports.onUpdateUser = functions.firestore
    .document('users/{userId}')
    .onUpdate(async (change, context) => {
        const userId = context.params.userId;
        const objUser = new HLUserModel(userId, change.after.data());

        const batch = db.batch();
        try {
            if (objUser.horseManager) {
                // update HorseManagerPaymentApprover
                const docApprovers = await db.collection(COLLECTION_PAYMENT_APPROVERS)
                    .where('userId', '==', userId)
                    .get();

                docApprovers.forEach(docApprover => {
                    const objApprover = new HLHorseManagerPaymentApproverModel(docApprover.id, docApprover.data());
                    objApprover.update(objUser.horseManager!);

                    batch.update(docApprover.ref, objApprover.toJSON());
                });

                // update HorseOwner
                const docHorseOwners = await db.collection(COLLECTION_HORSE_OWNERS)
                    .where('userId', '==', userId)
                    .get();

                docHorseOwners.forEach(docHorseOwner => {
                    const objHorseOwner = new HLHorseOwnerModel(docHorseOwner.id, docHorseOwner.data());
                    objHorseOwner.update(objUser.horseManager!);

                    batch.update(docHorseOwner.ref, objHorseOwner.toJSON());
                });
            }

            if (objUser.serviceProvider) {
                // update HorseManagerProvider
                const docHorseManagerProviders = await db.collection(COLLECTION_HORSE_MANAGER_PROVIDERS)
                    .where('userId', '==', userId)
                    .get();

                docHorseManagerProviders.forEach(docHorseManagerProvider => {
                    const objHorseManagerProvider = new HLHorseManagerProviderModel(docHorseManagerProvider.id, docHorseManagerProvider.data());
                    objHorseManagerProvider.update(objUser.serviceProvider!);

                    batch.update(docHorseManagerProvider.ref, objHorseManagerProvider.toJSON());
                });
            }
        } catch (err) {
            console.error(err);
        }

        return batch.commit();
    });

exports.onDeleteUser = functions.firestore
    .document('users/{userId}')
    .onDelete(async (snapshot, context) => {
        const userId = context.params.userId;
        const objUser = new HLUserModel(userId, snapshot.data());

        const promises: any[] = [];

        try {
            // delete auth
            promises.push(admin.auth().deleteUser(userId));

            if (objUser.horseManager) {
                // delete stripe customer
                if (objUser.horseManager.customer && objUser.horseManager.customer.id) {
                    promises.push(Stripes.deleteCustomer(objUser.horseManager.customer.id));
                }
                // remove horseManager avatar
                if (objUser.horseManager.avatarUrl) {
                    promises.push(storage.bucket().file(`/users/${userId}/manager.jpg`).delete());
                }
            }

            if (objUser.serviceProvider) {
                // reject stripe account
                if (objUser.serviceProvider.account && objUser.serviceProvider.account.id) {
                    promises.push(Stripes.rejectAccount(objUser.serviceProvider.account.id));
                }
                // remove serviceProvider avatar
                if (objUser.serviceProvider.avatarUrl) {
                    promises.push(storage.bucket().file(`/users/${userId}/provider.jpg`).delete());
                }
            }
        } catch (err) {
            console.error(err);
        }

        return Promise.all(promises);
    });

exports.onDeleteHorse = functions.firestore
    .document('horses/{horseId}')
    .onDelete(async (snapshot, context) => {
        const horseId = context.params.horseId;
        const objHorse = new HLHorseModel(horseId, snapshot.data());

        const promises: any[] = [];
        try {
            // remove horse owners
            const docHorseOwners = await db.collection(COLLECTION_HORSE_OWNERS)
                .where('horseId', '==', horseId)
                .get();

            docHorseOwners.forEach(docHorseOwner => {
                promises.push(docHorseOwner.ref.delete());
            });

            // remove service request
            const docServiceRequests = await db.collection(COLLECTION_SERVICE_REQUESTS)
                .where('horseId', '==', horseId)
                .get();

            docServiceRequests.forEach(docServiceRequest => {
                promises.push(docServiceRequest.ref.delete());
            });

            if (objHorse.avatarUrl) {
                promises.push(storage.bucket().file(`/horses/${objHorse.creatorId}/${objHorse.uid}`).delete());
            }
        } catch (err) {
            console.error(err);
        }

        return Promise.all(promises);
    });

/*
    Notification Triggers
 */

exports.onCreateNotification = functions.firestore
    .document('notifications/{notificationId}')
    .onCreate((snapshot, context) => {
        const notificationId = context.params.notificationId;
        return snapshot.ref.update({
            uid: notificationId
        });
    });

/*
    Payment Approver Triggers
 */
exports.onCreatePaymentApprover = functions.firestore
    .document('payment-approvers/{paId}')
    .onCreate(async (snapchat, context) => {
        const paId = context.params.paId;
        const objPaymentApprover = new HLHorseManagerPaymentApproverModel(paId, snapchat.data());

        const objCreator = await Global.fetchUser(objPaymentApprover.creatorId);
        if (null === objCreator || !objCreator.horseManager) return;

        const promises: any[] = [];
        // Push Notification
        const message = `${objCreator.horseManager.name} has authorized you to submit payment on their behalf.`;
        const payload = {
            notification: {
                title: 'Added as Payment Approver',
                body: message,
                sound: 'default'
            }
        };
        promises.push(Global.sendPushNotification(payload, [objPaymentApprover.userId]));

        // create notification
        const newNotificationValue = {
            message: message,
            receiverId: objPaymentApprover.userId,
            isRead: false,
            creator: new HLBaseUserModel(objCreator.horseManager.toJSON(false)).toJSON(),
            updatedAt: Date.now(),
            createdAt: Date.now()
        };
        promises.push(db.collection(COLLECTION_NOTIFICATIONS).doc().set(newNotificationValue));

        return Promise.all(promises);
    });

/*
    HorseOwner Triggers
 */
exports.onCreateHorseOwner = functions.firestore
    .document('horse-owners/{hoId}')
    .onCreate((snapshot, context) => {
        const hoId = context.params.hoId;
        const objHorseOwner = new HLHorseOwnerModel(hoId, snapshot.data());

        return db.collection(COLLECTION_HORSES).doc(objHorseOwner.horseId).update({
            ownerIds: FieldValue.arrayUnion(objHorseOwner.userId)
        });
    });

exports.onDeleteHorseOwner = functions.firestore
    .document('horse-owners/{hoId}')
    .onDelete((snapshot, context) => {
        const hoId = context.params.hoId;
        const objHorseOwner = new HLHorseOwnerModel(hoId, snapshot.data());

        return db.collection(COLLECTION_HORSES).doc(objHorseOwner.horseId).update({
            ownerIds: FieldValue.arrayRemove(objHorseOwner.userId)
        });
    });

/*
    HorseManagerProvider Triggers
 */
exports.onCreateHorseManagerProvider = functions.firestore
    .document('horse-manager-providers/{hmpId}')
    .onCreate(async (snapshot, context) => {
        const hmpId = context.params.hmpId;
        const objHorseManagerProvider = new HLHorseManagerProviderModel(hmpId, snapshot.data());

        const promises: any[] = [];

        promises.push(db.collection(COLLECTION_USERS).doc(objHorseManagerProvider.creatorId).update({
            'horseManager.providerIds': FieldValue.arrayUnion(objHorseManagerProvider.userId)
        }));

        const objCreator = await Global.fetchUser(objHorseManagerProvider.creatorId);
        if (null !== objCreator && objCreator.horseManager) {
            const message = `${objCreator.horseManager.name} has added you as a Service Provider. You can now invoice them for services`;
            // send push notification
            const payload = {
                notification: {
                    title: 'Service Request',
                    body: message,
                    sound: 'default'
                }
            };
            promises.push(Global.sendPushNotification(payload, [objHorseManagerProvider.userId]));

            // create notification
            const newNotificationValue = {
                message: message,
                receiverId: objHorseManagerProvider.userId,
                isRead: false,
                creator: new HLBaseUserModel(objHorseManagerProvider.toJSON()).toJSON(),
                updatedAt: Date.now(),
                createdAt: Date.now()
            };
            promises.push(db.collection(COLLECTION_NOTIFICATIONS).doc().set(newNotificationValue));
        }

        return Promise.all(promises);
    });

exports.onDeleteHorseManagerProvider = functions.firestore
    .document('horse-manager-providers/{hmpId}')
    .onDelete((snapshot, context) => {
        const hmpId = context.params.hmpId;
        const objHorseManagerProvider = new HLHorseManagerProviderModel(hmpId, snapshot.data());

        return db.collection(COLLECTION_HORSES).doc(objHorseManagerProvider.creatorId).update({
            'horseManager.providerIds': FieldValue.arrayRemove(objHorseManagerProvider.userId)
        });
    });

/*
    ServiceRequest Triggers
 */
exports.onCreateServiceRequest = functions.firestore
    .document('service-requests/{srId}')
    .onCreate(async (snapshot, context) => {
        const promises: any[] = [];

        try {
            const srId = context.params.srId;
            const objServiceRequest = await Global.updateServiceRequestInformation(new HLServiceRequestModel(srId, snapshot.data()));

            if (!objServiceRequest.serviceProvider || !objServiceRequest.horse || !objServiceRequest.creator) return;

            const message = `${objServiceRequest.creator.name} has scheduled a service with you for ${objServiceRequest.horse.barnName} on ${dateformat(objServiceRequest.requestDate, 'ddd, mmm dS, yyyy')}`;
            // send push notification
            if (Global.isSameDay(objServiceRequest.requestDate, new Date())) {
                const payload = {
                    notification: {
                        title: 'Service Request',
                        body: message,
                        sound: 'default',
                        badges: '1'
                    }
                };
                promises.push(Global.sendPushNotification(payload, [objServiceRequest.serviceProviderId]));
            }

            // create notification
            const newNotificationValue = {
                message: message,
                receiverId: objServiceRequest.serviceProviderId,
                isRead: false,
                creator: new HLBaseUserModel(objServiceRequest.serviceProvider.toJSON(false)).toJSON(),
                updatedAt: Date.now(),
                createdAt: Date.now()
            };
            promises.push(db.collection(COLLECTION_NOTIFICATIONS).doc().set(newNotificationValue));

            // add listeners
            promises.push(snapshot.ref.update({
                listenerUsers: getServiceRequestListeners(objServiceRequest).map(value => value.toJSON())
            }));
        } catch (err) {
            console.error(err);
        }

        return Promise.all(promises);
    });

exports.onUpdateServiceRequest = functions.firestore
    .document('service-requests/{srId}')
    .onUpdate(async (change, context) => {
        const srId = context.params.srId;
        const objBeforeServiceRequest = new HLServiceRequestModel(srId, change.before.data());

        const promises: any[] = [];

        try {
            const objAfterServiceRequest = await Global.updateServiceRequestInformation(new HLServiceRequestModel(srId, change.after.data()));

            if (!objBeforeServiceRequest.assignerId && objAfterServiceRequest.assignerId) { // added assigner
                if (objAfterServiceRequest.serviceProvider && objAfterServiceRequest.creator) {
                    const message = `${objAfterServiceRequest.serviceProvider.name} has assigned a service request to you from ${objAfterServiceRequest.creator.name}`;
                    // send push notification
                    const payload = {
                        notification: {
                            title: 'Reassign Service Request',
                            body: message,
                            sound: 'default'
                        }
                    };
                    promises.push(Global.sendPushNotification(payload, [objAfterServiceRequest.assignerId]));

                    // create notification
                    const newNotificationValue = {
                        message: message,
                        receiverId: objAfterServiceRequest.assignerId,
                        isRead: false,
                        creator: new HLBaseUserModel(objAfterServiceRequest.serviceProvider.toJSON(false)).toJSON(),
                        updatedAt: Date.now(),
                        createdAt: Date.now()
                    };
                    promises.push(db.collection(COLLECTION_NOTIFICATIONS).doc().set(newNotificationValue));
                }
            }

            if (HLServiceRequestStatus.declined !== objBeforeServiceRequest.status && HLServiceRequestStatus.declined === objAfterServiceRequest.status) {  // declined
                if (objAfterServiceRequest.serviceProvider && objAfterServiceRequest.creator) {
                    const message = `${objAfterServiceRequest.serviceProvider.name} has declined your request from ${objAfterServiceRequest.creator.name} for ${objAfterServiceRequest.horseBarnName}`;
                    // send push notification
                    const payload = {
                        notification: {
                            title: 'Declined Service Request',
                            body: message,
                            sound: 'default'
                        }
                    };
                    promises.push(Global.sendPushNotification(payload, [objAfterServiceRequest.creatorId]));

                    // create notification
                    const newNotificationValue = {
                        message: message,
                        receiverId: objAfterServiceRequest.creatorId,
                        isRead: false,
                        creator: new HLBaseUserModel(objAfterServiceRequest.serviceProvider.toJSON(false)).toJSON(),
                        updatedAt: Date.now(),
                        createdAt: Date.now()
                    };
                    promises.push(db.collection(COLLECTION_NOTIFICATIONS).doc().set(newNotificationValue));
                }
            }

            if (HLServiceRequestStatus.completed !== objBeforeServiceRequest.status && HLServiceRequestStatus.completed === objAfterServiceRequest.status) {  // declined
                if (objAfterServiceRequest.serviceProvider && objAfterServiceRequest.creator) {
                    const message = `${objAfterServiceRequest.serviceProvider.name} has completed request from ${objAfterServiceRequest.creator.name} for ${objAfterServiceRequest.horseBarnName}`;
                    // send push notification
                    const payload = {
                        notification: {
                            title: 'Completed Service Request',
                            body: message,
                            sound: 'default'
                        }
                    };
                    promises.push(Global.sendPushNotification(payload, [objAfterServiceRequest.creatorId]));

                    // create notification
                    const newNotificationValue = {
                        message: message,
                        receiverId: objAfterServiceRequest.creatorId,
                        isRead: false,
                        creator: new HLBaseUserModel(objAfterServiceRequest.serviceProvider.toJSON(false)).toJSON(),
                        updatedAt: Date.now(),
                        createdAt: Date.now()
                    };
                    promises.push(db.collection(COLLECTION_NOTIFICATIONS).doc().set(newNotificationValue));
                }
            }

            promises.push(change.after.ref.update({
                listenerUsers: getServiceRequestListeners(objAfterServiceRequest).map(value => value.toJSON())
            }));
        } catch (err) {
            console.error(err);
        }
        return Promise.all(promises);
    });

function getServiceRequestListeners(objServiceRequest: HLServiceRequestModel) {
    const listeners: HLListenerUserModel[] = [];

    let objListener = new HLListenerUserModel({ userId: objServiceRequest.serviceProviderId, userType: HLUserType.provider });
    listeners.push(objListener);

    if (objServiceRequest.assignerId) {
        objListener = new HLListenerUserModel({ userId: objServiceRequest.assignerId, userType: HLUserType.provider });
        listeners.push(objListener);
    }
    if (objServiceRequest.horse) {
        if (objServiceRequest.horse.leaserId) {
            objListener = new HLListenerUserModel({ userId: objServiceRequest.horse.leaserId, userType: HLUserType.manager });
            listeners.push(objListener);
        }
        if (objServiceRequest.horse.ownerIds) {
            objServiceRequest.horse.ownerIds.forEach(ownerId => {
                if (-1 === listeners.findIndex(value => value.userId === ownerId && HLUserType.manager === value.userType)) {
                    objListener = new HLListenerUserModel({ userId: ownerId, userType: HLUserType.manager });
                    listeners.push(objListener);
                }
            });
        }
        if (-1 === listeners.findIndex(value => value.userId === objServiceRequest.horse!.trainerId && HLUserType.manager === value.userType)) {
            objListener = new HLListenerUserModel({
                userId: objServiceRequest.horse.trainerId,
                userType: HLUserType.manager
            });
            listeners.push(objListener);
        }
    }

    return listeners
}

/*
    Invoice Triggers
 */
exports.onCreateInvoice = functions.firestore
    .document('invoices/{invoiceId}')
    .onCreate(async (snapshot, context) => {
        const invoiceId = context.params.invoiceId;
        const objInvoice = new HLInvoiceModel(invoiceId, snapshot.data());

        const promises: any[] = [];
        try {
            // update request status to invoiced
            for (const requestId of objInvoice.requestIds) {
                promises.push(db.collection(COLLECTION_SERVICE_REQUESTS).doc(requestId).update({
                    status: HLServiceRequestStatus.invoiced
                }));
            }

            // send email and push to owners
            const updateInvoice = await Global.updateInvoiceInformation(objInvoice);
            if (updateInvoice.requests
                && updateInvoice.requests[0].serviceProvider
                && updateInvoice.payers) {
                const objServiceProvider = updateInvoice.requests[0].serviceProvider;

                const receiverIds = updateInvoice.payers.map(value => value.userId);

                // Push Notification
                const message = `You have new invoice from ${objServiceProvider.name}.`;
                const payload = {
                    notification: {
                        title: 'New Invoice',
                        body: message,
                        sound: 'default'
                    }
                };
                promises.push(Global.sendPushNotification(payload, receiverIds));

                // create notification
                receiverIds.forEach(receiverId => {
                    const newNotificationValue = {
                        message: message,
                        receiverId: receiverId,
                        isRead: false,
                        creator: new HLBaseUserModel(objServiceProvider.toJSON(false)).toJSON(),
                        updatedAt: Date.now(),
                        createdAt: Date.now()
                    };
                    promises.push(db.collection(COLLECTION_NOTIFICATIONS).doc().set(newNotificationValue));
                });

                // Email

                // Add Listeners
                promises.push(snapshot.ref.update({
                    listenerUsers: getInvoiceListeners(updateInvoice).map(value => value.toJSON())
                }));
            }
        } catch (err) {
            console.error(err);
        }

        return Promise.all(promises);
    });

exports.onUpdateInvoice = functions.firestore
    .document('invoices/{invoiceId}')
    .onUpdate(async (change, context) => {
        const invoiceId = context.params.invoiceId;
        const objInvoice = new HLInvoiceModel(invoiceId, change.after.data());

        const promises: any[] = [];
        try {
            const updateInvoice = await Global.updateInvoiceInformation(objInvoice);

            // Add Listeners
            promises.push(change.after.ref.update({
                listenerUsers: getInvoiceListeners(updateInvoice).map(value => value.toJSON())
            }));
        } catch (err) {
            console.error(err);
        }

        return Promise.all(promises);
    });

function getInvoiceListeners(objInvoice: HLInvoiceModel) {
    const listeners: HLListenerUserModel[] = [];

    // add service provider and assigner of invoice requests
    let objListener: HLListenerUserModel;
    if (objInvoice.requests) {
        objInvoice.requests.forEach(objServiceRequest => {
            if (-1 === listeners.findIndex(value => value.userId === objServiceRequest.serviceProviderId && HLUserType.provider === value.userType)) {
                objListener = new HLListenerUserModel({
                    userId: objServiceRequest.serviceProviderId,
                    userType: HLUserType.provider
                });
                listeners.push(objListener);
            }

            if (objServiceRequest.assignerId
                && (-1 === listeners.findIndex(value => value.userId === objServiceRequest.assignerId && HLUserType.provider === value.userType)) ) {
                objListener = new HLListenerUserModel({ userId: objServiceRequest.assignerId, userType: HLUserType.provider });
                listeners.push(objListener);
            }
        });
    }

    if (objInvoice.payers) {
        objInvoice.payers.forEach(objPayer => {
            if (-1 === listeners.findIndex(value => value.userId === objPayer.userId && HLUserType.manager === value.userType)) {
                objListener = new HLListenerUserModel({
                    userId: objPayer.userId,
                    userType: HLUserType.manager
                });
                listeners.push(objListener);
            }
        });
    }

    if (objInvoice.paymentApprovers) {
        objInvoice.paymentApprovers.forEach(objPaymentApprover => {
            if (-1 === listeners.findIndex(value => value.userId === objPaymentApprover.userId && HLUserType.manager === value.userType)) {
                objListener = new HLListenerUserModel({
                    userId: objPaymentApprover.userId,
                    userType: HLUserType.manager
                });
                listeners.push(objListener);
            }
        });
    }

    return listeners
}

/*
 Calls
 */
exports.createCustomer = functions.https.onCall(async data => {
    const userId: string = data.userId;

    try {
        const objUser = await Global.fetchUser(userId);
        if (null === objUser) {
            return new functions.https.HttpsError('invalid-argument', 'Invalid user id');
        }

        if (objUser.horseManager && objUser.horseManager.customer) {
            return objUser.horseManager.customer.toJSON();
        }

        const newCustomer = await Stripes.createStripeCustomer(objUser);
        const objCustomer = new HLStripeCustomerModel(newCustomer, true);
        await db.collection(COLLECTION_USERS).doc(userId).update({
            'horseManager.customer': objCustomer.toJSON()
        });

        return objCustomer.toJSON();
    } catch (err) {
        console.error('CreateCustomer =>', err);
        throw new functions.https.HttpsError('invalid-argument', err.message);
    }
});

exports.addCardToCustomer = functions.https.onCall(async data => {
    const userId: string = data.userId;
    const customerId: string = data.customerId;
    const sourceId: string = data.sourceId;

    try {
        // add new card to customer
        const card = await Stripes.addSourceToCustomer(customerId, sourceId);
        if (null === card) {
            return new functions.https.HttpsError('invalid-argument', 'Invalid card');
        }

        const customer = await Stripes.retrieveCustomer(customerId);
        const objCustomer = new HLStripeCustomerModel(customer, true);
        await db.collection(COLLECTION_USERS).doc(userId).update({
            'horseManager.customer': objCustomer.toJSON()
        });

        return objCustomer.toJSON();
    } catch (err) {
        console.error('AddCardToCustomer =>', err);
        throw new functions.https.HttpsError('invalid-argument', err.message);
    }
});

exports.changeDefaultCard = functions.https.onCall(async data => {
    const userId: string = data.userId;
    const customerId: string = data.customerId;
    const sourceId: string = data.sourceId;

    try {
        const card = await Stripes.updateDefaultSource(customerId, sourceId);
        if (null === card) {
            return new functions.https.HttpsError('invalid-argument', 'Invalid card id');
        }

        const customer = await Stripes.retrieveCustomer(customerId);
        const objCustomer = new HLStripeCustomerModel(customer, true);
        await db.collection(COLLECTION_USERS).doc(userId).update({
            'horseManager.customer': objCustomer.toJSON()
        });

        return objCustomer.toJSON();
    } catch (err) {
        console.error('ChangeDefaultCard =>', err);
        throw new functions.https.HttpsError('invalid-argument', err.message);
    }
});

exports.deleteCard = functions.https.onCall(async data => {
    const userId: string = data.userId;
    const customerId: string = data.customerId;
    const sourceId: string = data.sourceId;

    try {
        await Stripes.deleteSourceFromCustomer(customerId, sourceId);
        const customer = await Stripes.retrieveCustomer(customerId);
        const objCustomer = new HLStripeCustomerModel(customer, true);
        await db.collection(COLLECTION_USERS).doc(userId).update({
            'horseManager.customer': objCustomer.toJSON()
        });

        return objCustomer.toJSON();
    } catch (err) {
        console.error('DeleteCard =>', err);
        throw new functions.https.HttpsError('invalid-argument', err.message);
    }
});

exports.getExpressLoginUrl = functions.https.onCall(data => {
    const accountId: string = data.accountId;

    return Stripes.createExpressLoginLink(accountId).then(response => {
        return response;
    }).catch(error => {
        throw new functions.https.HttpsError('invalid-argument', error.message);
    })
});

exports.searchHorseManagers = functions.https.onCall(async data => {
    const query: string = data.query;
    const limit: number = data.limit || USER_SEARCH_LIMIT;
    const lastUserId: string | undefined = data.lastUserId;

    // more functions
    const excludeIds: string[] = data.excludeIds || [];

    if (MIN_QUERY_LEN > query.length) {
        throw new functions.https.HttpsError('invalid-argument', 'Not enough query length.');
    }

    try {
        const aryHorseManagers: HLHorseManagerModel[] = [];

        let noMoreUsers = false;
        let docLastUser: admin.firestore.DocumentSnapshot | undefined;
        if (lastUserId) {
            docLastUser = await db.collection(COLLECTION_USERS).doc(lastUserId).get();
        }

        const queryLimit = Global.queryLimit(limit);
        while (!noMoreUsers) {
            let queryUser = db.collection(COLLECTION_USERS).orderBy('horseManager.name');
            if (docLastUser && docLastUser.exists) {
                queryUser = queryUser.startAfter(docLastUser);
            }
            queryUser = queryUser.limit(queryLimit);
            const docUsers = await queryUser.get();
            if (docUsers.empty) break;

            noMoreUsers = queryLimit > docUsers.docs.length;

            for(const docUser of docUsers.docs) {
                const objUser = new HLUserModel(docUser.id, docUser.data());
                if (excludeIds.includes(objUser.uid)) continue;

                if (objUser.horseManager
                    && objUser.horseManager.name.toLowerCase().includes(query.toLowerCase())) {
                    aryHorseManagers.push(objUser.horseManager);
                    if (limit === aryHorseManagers.length) break;
                }
            }

            if (limit === aryHorseManagers.length) break;
            docLastUser = docUsers.docs[docUsers.docs.length - 1];
        }

        return aryHorseManagers.map(value => value.toJSON(false));
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});

exports.searchServiceProviders = functions.https.onCall(async data => {
    const query: string = data.query;
    const limit: number = data.limit || USER_SEARCH_LIMIT;
    const lastUserId: string | undefined = data.lastUserId;

    // more functions
    const excludeIds: string[] = data.excludeIds || [];

    if (MIN_QUERY_LEN > query.length) {
        throw new functions.https.HttpsError('invalid-argument', 'Not enough query length.');
    }

    try {
        const aryServiceProviders: HLServiceProviderModel[] = [];

        let noMoreUsers = false;
        let docLastUser: admin.firestore.DocumentSnapshot | undefined;
        if (lastUserId) {
            docLastUser = await db.collection(COLLECTION_USERS).doc(lastUserId).get();
        }
        const queryLimit = Global.queryLimit(limit);
        while (!noMoreUsers) {
            let queryUser = db.collection(COLLECTION_USERS).orderBy('serviceProvider.name');
            if (docLastUser && docLastUser.exists) {
                queryUser = queryUser.startAfter(docLastUser);
            }
            queryUser = queryUser.limit(queryLimit);

            const docUsers = await queryUser.get();
            if (docUsers.empty) break;

            noMoreUsers = queryLimit > docUsers.docs.length;

            for(const docUser of docUsers.docs) {
                const objUser = new HLUserModel(docUser.id, docUser.data());
                if (excludeIds.includes(objUser.uid)) continue;

                if (objUser.serviceProvider
                    && objUser.serviceProvider.name.toLowerCase().includes(query.toLowerCase())) {
                    aryServiceProviders.push(objUser.serviceProvider);
                    if (limit === aryServiceProviders.length) break;
                }
            }

            if (limit === aryServiceProviders.length) break;
            docLastUser = docUsers.docs[docUsers.docs.length - 1];
        }

        return aryServiceProviders.map(value => value.toJSON(false));
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});

exports.searchHorses = functions.https.onCall(async data => {
    const userId: string = data.userId;
    const query: string | undefined = data.query;
    const excludeIds: string[] = data.excludeIds || [];

    const objUser = await Global.fetchUser(userId);
    if (null === objUser) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid user id');
    }

    if (HLUserType.manager === objUser.type) {
        try {
            const limit: number = data.limit || HORSE_SEARCH_LIMIT;
            const lastHorseId: string | undefined = data.lastHorseId;

            // filter
            const trainerId: string | undefined = data.trainerId;
            const ownerId: string | undefined = data.ownerId;
            const sort: { name: 'barnName' | 'createdAt', order?: 'desc' | 'asc' | undefined } = data.sort || {name: 'barnName'};

            const aryHorses: HLHorseModel[] = [];

            let noMoreHorses = false;

            let docLastHorse: admin.firestore.DocumentSnapshot | undefined;
            if (lastHorseId) {
                docLastHorse = await db.collection(COLLECTION_HORSES).doc(lastHorseId).get();
            }

            const queryLimit = Global.queryLimit(limit);
            while (!noMoreHorses) {
                let queryHorses = db.collection(COLLECTION_HORSES)
                    .where('isDeleted', '==', false)
                    .orderBy(sort.name, sort.order);

                if (docLastHorse && docLastHorse.exists) {
                    queryHorses = queryHorses.startAfter(docLastHorse);
                }
                queryHorses = queryHorses.limit(queryLimit);

                const docHorses = await queryHorses.get();
                if (docHorses.empty) break;

                noMoreHorses = queryLimit > docHorses.docs.length;

                for (const docHorse of docHorses.docs) {
                    let objHorse = new HLHorseModel(docHorse.id, docHorse.data());
                    if (excludeIds.includes(objHorse.uid)) continue;

                    if (userId === objHorse.trainerId
                        || (objHorse.ownerIds && objHorse.ownerIds.includes(userId))
                        || userId === objHorse.leaserId) {

                        // filter
                        if (trainerId && 0 < trainerId.length) {
                            if (trainerId !== objHorse.trainerId) continue;
                        }
                        if (ownerId && 0 < ownerId.length) {
                            if (!objHorse.ownerIds || !objHorse.ownerIds.includes(ownerId)) continue;
                        }

                        objHorse = await Global.updateHorseDetailInformation(objHorse);
                        aryHorses.push(objHorse);

                        if (limit === aryHorses.length) break
                    }
                }

                if (limit === aryHorses.length) break;

                docLastHorse = docHorses.docs[docHorses.docs.length - 1];
            }

            return aryHorses.map(value => value.toJSON());
        } catch (err) {
            throw new functions.https.HttpsError('internal', err);
        }
    } else {
        if (query && query.length < MIN_QUERY_LEN) {
            throw new functions.https.HttpsError('invalid-argument', 'Not enough query length.');
        }

        try {
            // get HorseManagers who added user as provider
            const docUsers = await db.collection(COLLECTION_USERS)
                .where('horseManager.providerIds', 'array-contains', userId)
                .get();

            const aryHorseManagers: HLHorseManagerModel[] = [];

            if (query) {
                const limit: number = data.limit || HORSE_SEARCH_LIMIT;
                const lastHorseId: string | undefined = data.lastHorseId;

                docUsers.forEach(docUser => {
                    const tmpUser = new HLUserModel(docUser.id, docUser.data());
                    if (tmpUser.horseManager) {
                        aryHorseManagers.push(tmpUser.horseManager);
                    }
                });

                let docLastHorse: admin.firestore.DocumentSnapshot | undefined;
                if (lastHorseId) {
                    docLastHorse = await db.collection(COLLECTION_HORSES).doc(lastHorseId).get();
                }
                let noMoreHorses = false;

                const aryHorses: HLHorseModel[] = [];

                const queryLimit = Global.queryLimit(limit);
                while (!noMoreHorses) {
                    let queryHorses = db.collection(COLLECTION_HORSES)
                        .where('isDeleted', '==', false)
                        .orderBy('barnName');

                    if (docLastHorse && docLastHorse.exists) {
                        queryHorses = queryHorses.startAfter(docLastHorse);
                    }
                    queryHorses = queryHorses.limit(queryLimit);
                    const docHorses = await queryHorses.get();
                    if (docHorses.empty) break;

                    noMoreHorses = queryLimit > docHorses.docs.length;

                    for (const docHorse of docHorses.docs) {
                        let objHorse = new HLHorseModel(docHorse.id, docHorse.data());

                        // if a horse is included to excluded ids or already added to aryHorses, continue;
                        if (excludeIds.includes(objHorse.uid)
                            || -1 < aryHorses.findIndex(value => {
                                return value.uid === objHorse.uid;
                            })) continue;

                        // if query is not match with barnName or displayName, continue;
                        if (!objHorse.barnName.toLowerCase().includes(query.toLowerCase())
                            && !objHorse.displayName.toLowerCase().includes(query.toLowerCase())) continue;

                        for (const objHorseManager of aryHorseManagers) {
                            if (objHorse.ownerIds && objHorse.ownerIds.includes(objHorseManager.userId)) {
                                objHorse = await Global.updateHorseDetailInformation(objHorse);
                                aryHorses.push(objHorse);
                                break;
                            }
                        }

                        if (limit === aryHorses.length) break;
                    }

                    if (limit === aryHorses.length) break;
                    docLastHorse = docHorses.docs[docHorses.docs.length - 1];
                }

                return aryHorses.map(value => value.toJSON());

            } else {
                docUsers.forEach(docUser => {
                    const tmpUser = new HLUserModel(docUser.id, docUser.data());
                    if (tmpUser.horseManager) {
                        aryHorseManagers.push(tmpUser.horseManager);
                    }
                });
                const docHorses = await db.collection(COLLECTION_HORSES)
                    .where('isDeleted', '==', false)
                    .get();

                const aryServiceHorses: { manager: HLHorseManagerModel, horses: HLHorseModel[] }[] = [];

                for (const objHorseManager of aryHorseManagers) {
                    const aryHorses: HLHorseModel[] = [];
                    for (const docHorse of docHorses.docs) {
                        let objHorse = new HLHorseModel(docHorse.id, docHorse.data());
                        if (excludeIds.includes(objHorse.uid)) continue;

                        if (objHorseManager.userId === objHorse.trainerId
                            || (objHorse.ownerIds && objHorse.ownerIds.includes(objHorseManager.userId))
                            || userId === objHorse.leaserId) {
                            objHorse = await Global.updateHorseDetailInformation(objHorse);
                            aryHorses.push(objHorse);
                        }
                    }

                    if (0 < aryHorses.length) {
                        aryServiceHorses.push({
                            manager: objHorseManager,
                            horses: aryHorses
                        });
                    }
                }

                return aryServiceHorses.map(value => {
                    return {
                        manager: value.manager.toJSON(),
                        horses: value.horses.map(horse => horse.toJSON())
                    }
                });
            }
        } catch (err) {
            throw new functions.https.HttpsError('internal', err);
        }
    }

});

exports.searchHorseUsers = functions.https.onCall(async data => {
    const userId: string = data.userId;
    const excludeIds: string[] = data.excludeIds || [];

    const objUser = await Global.fetchUser(userId);
    if (null === objUser) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid user id');
    }

    try {
        const limit: number = data.limit || USER_SEARCH_LIMIT;
        const lastUserId: string | undefined = data.lastUserId;
        const searchType: HLHorseUserSearchType = data.searchType;

        let aryUsers: HLHorseManagerModel[] = [];

        const docHorses = await db.collection(COLLECTION_HORSES)
            .where('isDeleted', '==', false)
            .get();

        for(const docHorse of docHorses.docs) {
            const objHorse = new HLHorseModel(docHorse.id, docHorse.data());

            if (userId === objHorse.trainerId
                || (objHorse.ownerIds && objHorse.ownerIds.includes(userId))
                || userId === objHorse.leaserId) {
                switch (searchType) {
                    case HLHorseUserSearchType.owner:
                        if (!objHorse.ownerIds) break;

                        for (const ownerId of objHorse.ownerIds) {
                            if (!excludeIds.includes(ownerId)
                                && -1 === aryUsers.findIndex(value => {
                                    return value.userId === ownerId;
                                })) {
                                const objOwner = await Global.fetchUser(ownerId);
                                if (null !== objOwner && objOwner.horseManager) {
                                    aryUsers.push(objOwner.horseManager);
                                }
                            }
                        }
                        break;

                    case HLHorseUserSearchType.trainer:
                        if (!excludeIds.includes(objHorse.trainerId)
                            && -1 === aryUsers.findIndex(value => {
                                return value.userId === objHorse.trainerId;
                            })) {
                            const objTrainer = await Global.fetchUser(objHorse.trainerId);
                            if (null !== objTrainer && objTrainer.horseManager) {
                                aryUsers.push(objTrainer.horseManager);
                            }
                        }
                        break;
                }
            }
        }

        // sort and limit
        aryUsers = aryUsers.sort((objUser1, objUser2) => {
            if (objUser1.name < objUser2.name) {
                return -1;
            } else if (objUser1.name > objUser2.name) {
                return 1;
            }

            return 0;
        });

        let firstUserIndex = 0;
        if (lastUserId) {
            firstUserIndex = aryUsers.findIndex(value => {
                return value.userId === lastUserId;
            });

            firstUserIndex = -1 === firstUserIndex ? 0 : firstUserIndex + 1;
        }
        aryUsers = aryUsers.slice(firstUserIndex, firstUserIndex + limit);

        return aryUsers.map(value => value.toJSON(false));
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});

exports.searchServiceShows = functions.https.onCall(async data => {
    const query: string = data.query;
    const limit: number = data.number || SERVICE_SHOW_LIMIT;
    const lastShowId: string | undefined = data.lastShowId;
    const excludeIds: string[] = data.excludeIds || [];

    if (MIN_QUERY_LEN > query.length) {
        throw new functions.https.HttpsError('invalid-argument', 'Not enough query length.');
    }

    try {
        const aryShows: HLServiceShowModel[] = [];

        let docLastShow: admin.firestore.DocumentSnapshot | undefined;
        if (lastShowId) {
            docLastShow = await db.collection(COLLECTION_SERVICE_SHOWS).doc(lastShowId).get();
        }
        let noMoreShows = false;

        const queryLimit = limit * 2;
        while (!noMoreShows) {
            let queryShow = db.collection(COLLECTION_SERVICE_SHOWS).orderBy('name');

            if (docLastShow && docLastShow.exists) {
                queryShow = queryShow.startAfter(docLastShow);
            }
            queryShow = queryShow.limit(queryLimit);

            const docShows = await queryShow.get();
            if (docShows.empty) break;

            noMoreShows = queryLimit > docShows.docs.length;

            for(const docShow of docShows.docs) {
                const objServiceShow = new HLServiceShowModel(docShow.id, docShow.data());
                if (excludeIds.includes(objServiceShow.uid)) continue;

                if (objServiceShow.name.toLowerCase().includes(query.toLowerCase())) {
                    aryShows.push(objServiceShow);
                    if (limit === aryShows.length) break;
                }
            }

            if (limit === aryShows.length) break;
            docLastShow = docShows.docs[docShows.docs.length - 1];
        }

        return aryShows.map(value => value.toJSON());
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});

/*
    Service Requests
 */
exports.searchServiceRequests = functions.https.onCall(async data => {
    try {
        const horseId: string | undefined = data.horseId;
        const serviceProviderId: string | undefined = data.serviceProviderId;
        const statuses: HLServiceRequestStatus[] | undefined = data.statuses;

        const limit: number = data.limit || SERVICE_REQUEST_LIMIT;
        const lastRequestId: string | undefined = data.lastRequestId;

        // filter
        const startDate: number | undefined = data.startDate;
        const endDate: number | undefined = data.endDate;
        const sort: {name: 'horseBarnName' | 'horseDisplayName', order?: 'desc' | 'asc' | undefined} | undefined = data.sort;

        const aryServiceRequests: HLServiceRequestModel[] = [];

        let noMoreServiceRequests = false;
        let docLastServiceRequest: admin.firestore.DocumentSnapshot | undefined;
        if (lastRequestId) {
            docLastServiceRequest = await db.collection(COLLECTION_SERVICE_REQUESTS).doc(lastRequestId).get();
        }

        const queryLimit = Global.queryLimit(limit);
        while (!noMoreServiceRequests) {
            let queryServiceRequests = db.collection(COLLECTION_SERVICE_REQUESTS).orderBy('requestDate', 'desc');
            if (horseId) {
                queryServiceRequests = queryServiceRequests.where('horseId', '==', horseId);
            }
            if (startDate) {
                queryServiceRequests = queryServiceRequests.where('requestDate', '>=', startDate);
            }
            if (endDate) {
                queryServiceRequests = queryServiceRequests.where('requestDate', '<=', endDate);
            }
            if (sort) {
                queryServiceRequests = queryServiceRequests.orderBy(sort.name, sort.order);
            }
            if (docLastServiceRequest && docLastServiceRequest.exists) {
                queryServiceRequests = queryServiceRequests.startAfter(docLastServiceRequest);
            }
            queryServiceRequests = queryServiceRequests.limit(queryLimit);

            const docServiceRequests = await queryServiceRequests.get();
            if (docServiceRequests.empty) break;

            noMoreServiceRequests = queryLimit > docServiceRequests.docs.length;

            for (const docServiceRequest of docServiceRequests.docs) {
                let objServiceRequest = new HLServiceRequestModel(docServiceRequest.id, docServiceRequest.data());

                // statuses filter
                if (statuses && !statuses.includes(objServiceRequest.status)) continue;
                // custom invoice filter for horse manager
                if (horseId && objServiceRequest.isCustomRequest) continue;
                // assigner filter
                if (serviceProviderId) {
                    // dismissed by
                    if (objServiceRequest.dismissedBy && objServiceRequest.dismissedBy.includes(serviceProviderId)) continue;
                    if (serviceProviderId !== objServiceRequest.assignerId
                        && serviceProviderId !== objServiceRequest.serviceProviderId) continue;
                }

                objServiceRequest = await Global.updateServiceRequestInformation(objServiceRequest);
                aryServiceRequests.push(objServiceRequest);
                if (limit === aryServiceRequests.length) break;
            }

            if (limit === aryServiceRequests.length) break;
            docLastServiceRequest = docServiceRequests.docs[docServiceRequests.docs.length - 1];
        }

        return aryServiceRequests.map(value => value.toJSON());
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});

exports.getServiceRequest = functions.https.onCall(async data => {
    const serviceRequestId = data.serviceRequestId;

    try {
        const docServiceRequest = await db.collection(COLLECTION_SERVICE_REQUESTS).doc(serviceRequestId).get();
        if (docServiceRequest.exists) {
            const objServiceRequest = new HLServiceRequestModel(docServiceRequest.id, docServiceRequest.data());
            return await Global.updateServiceRequestInformation(objServiceRequest);
        }

        return null;
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});

/*
    Invoices
 */
exports.searchInvoices = functions.https.onCall(async data => {
    const userId: string = data.userId;
    const statuses: HLInvoiceStatus[] | undefined = data.statuses;

    const limit: number = data.limit || INVOICE_LIMIT;
    const lastInvoiceId: string | undefined = data.lastInvoiceId;

    const objUser = await Global.fetchUser(userId);
    if (null === objUser) {
        throw new functions.https.HttpsError('invalid-argument', 'No user exists');
    }

    try {
        const aryInvoices: HLInvoiceModel[] = [];

        let docLastInvoice: admin.firestore.DocumentSnapshot | undefined;
        if (lastInvoiceId) {
            docLastInvoice = await db.collection(COLLECTION_INVOICES).doc(lastInvoiceId).get();
        }

        let noMoreInvoices = false;

        const queryLimit = Global.queryLimit(limit);
        while (!noMoreInvoices) {
            let queryInvoice = db.collection(COLLECTION_INVOICES).orderBy('createdAt', 'desc');
            if (docLastInvoice && docLastInvoice.exists) {
                queryInvoice = queryInvoice.startAfter(docLastInvoice);
            }
            queryInvoice = queryInvoice.limit(queryLimit);

            const docInvoices = await queryInvoice.get();
            if (docInvoices.empty) break;

            noMoreInvoices = queryLimit > docInvoices.docs.length;

            for (const docInvoice of docInvoices.docs) {
                const tmpInvoice = new HLInvoiceModel(docInvoice.id, docInvoice.data());
                if (statuses && !statuses.includes(tmpInvoice.status)) continue;

                const objInvoice = await Global.updateInvoiceInformation(tmpInvoice);
                if (HLUserType.provider === objUser.type) {
                    if (objInvoice.requests && 0 < objInvoice.requests.length && objInvoice.requests[0].serviceProviderId === userId) {
                        aryInvoices.push(objInvoice);
                    }
                } else {
                    if ((objInvoice.payers && -1 < objInvoice.payers.findIndex(value => {
                        return value.userId === userId
                    })) || (objInvoice.paymentApprovers && -1 < objInvoice.paymentApprovers.findIndex(value => {
                        return value.userId === userId
                    }))) {
                        aryInvoices.push(objInvoice);
                    }
                }

                if (limit === aryInvoices.length) break;
            }

            if (limit === aryInvoices.length) break;
            docLastInvoice = docInvoices.docs[docInvoices.docs.length - 1];
        }

        return aryInvoices.map(value => value.toJSON());
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }

});

exports.getInvoice = functions.https.onCall(async data => {
    const invoiceId = data.invoiceId;

    try {
        const docInvoice = await db.collection(COLLECTION_INVOICES).doc(invoiceId).get();
        if (docInvoice.exists) {
            const objInvoice = new HLInvoiceModel(docInvoice.id, docInvoice.data());
            return await Global.updateInvoiceInformation(objInvoice);
        }

        return null;
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});


exports.exportInvoices = functions.https.onCall(async data => {
    const userId: string = data.userId;

    const status: HLInvoiceStatus | undefined = data.status;
    const startDate: number | undefined = data.startDate;
    const endDate: number | undefined = data.endDate;

    const serviceProviderIds: string[] | undefined = data.serviceProviderIds;
    const horseManagerIds: string[] | undefined = data.horseManagerIds;
    const horseIds: string[] | undefined = data.horseIds;

    const objUser = await Global.fetchUser(userId);
    if (null === objUser) {
        throw new functions.https.HttpsError('invalid-argument', 'No user exists');
    }

    try {
        const aryInvoices: HLInvoiceModel[] = [];

        let queryInvoice = db.collection(COLLECTION_INVOICES).orderBy('createdAt', 'desc');
        if (startDate) {
            queryInvoice = queryInvoice.where('createdAt', '>=', startDate);
        }
        if (endDate) {
            queryInvoice = queryInvoice.where('createdAt', '<=', endDate);
        }
        if (status) {
            queryInvoice = queryInvoice.where('status', '==', status);
        }

        const docInvoices = await queryInvoice.get();
        for (const docInvoice of docInvoices.docs) {
            const objInvoice = await Global.updateInvoiceInformation(new HLInvoiceModel(docInvoice.id, docInvoice.data()));
            if (horseIds && 0 < horseIds.length && objInvoice.requests) {
                let hasSameHorse = false;
                for (const horseId of horseIds) {
                    if (-1 < objInvoice.requests.findIndex(value => {
                        return value.horseId === horseId;
                    })) {
                        hasSameHorse = true;
                        break;
                    }
                }

                if (!hasSameHorse) continue;
            }

            if (HLUserType.provider === objUser.type) {
                if (objInvoice.requests && 0 < objInvoice.requests.length && objInvoice.requests[0].serviceProviderId === userId) {
                    if (horseManagerIds && 0 < horseManagerIds.length) {
                        for (const horseManagerId of horseManagerIds) {
                            if ((objInvoice.payers && -1 < objInvoice.payers.findIndex(value => {
                                return value.userId === horseManagerId
                            })) || (objInvoice.paymentApprovers && -1 < objInvoice.paymentApprovers.findIndex(value => {
                                return value.userId === horseManagerId
                            }))) {
                                aryInvoices.push(objInvoice);
                                break;
                            }
                        }
                    } else {
                        aryInvoices.push(objInvoice);
                    }
                }
            } else {
                if ((objInvoice.payers && -1 < objInvoice.payers.findIndex(value => {
                    return value.userId === userId
                })) || (objInvoice.paymentApprovers && -1 < objInvoice.paymentApprovers.findIndex(value => {
                    return value.userId === userId
                }))) {
                    if (serviceProviderIds && 0 < serviceProviderIds.length) {
                        for (const serviceProviderId of serviceProviderIds) {
                            if (objInvoice.requests && 0 < objInvoice.requests.length && objInvoice.requests[0].serviceProviderId === serviceProviderId) {
                                aryInvoices.push(objInvoice);
                                break;
                            }
                        }
                    } else {
                        aryInvoices.push(objInvoice);
                    }
                }
            }
        }

        if (0 === aryInvoices.length) {
            return new functions.https.HttpsError('not-found', 'No invoices to be matched to your filters.');
        }

        // create csv
        const csv = Global.makeCSVStringWithInvoices(aryInvoices);
        console.log('CSV =>', csv);

        // send email

        return new HLMessageModel('Sent an email with invoice csv attachment successfully.').toJSON();
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});

exports.requestPaymentSubmission = functions.https.onCall(async data => {
    const assignerId: string = data.assignerId;
    const serviceProviderId: string = data.serviceProviderId;
    const requestIds: string[] = data.requestIds;

    const objAssigner = await Global.fetchUser(assignerId);
    if (null === objAssigner) {
        throw new functions.https.HttpsError('invalid-argument', 'No user exists');
    }

    const promises: Promise<admin.firestore.DocumentSnapshot>[] = [];
    for (const requestId of requestIds) {
        promises.push(db.collection(COLLECTION_SERVICE_REQUESTS).doc(requestId).get());
    }
    const docRequests = await Promise.all(promises);
    const aryRequests = docRequests.map(docRequest => new HLServiceRequestModel(docRequest.id, docRequest.data()))
        .filter(value => !value.dismissedBy || !value.dismissedBy.includes(serviceProviderId));

    if (0 === aryRequests.length) {
        throw new functions.https.HttpsError('not-found', 'This invoice is deleted by Service Provider');
    }

    try {
        const message = `${objAssigner.serviceProvider!.name} has requested an invoice submission. Please review and submit the joint invoice waiting in your Drafts.`;
        const payload = {
            notification: {
                title: 'Request Payment Submission',
                body: message,
                sound: 'default'
            }
        };
        await Global.sendPushNotification(payload, [serviceProviderId]);

        // send email

        return new HLMessageModel('Sent a payment submission request successfully.').toJSON();
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});

exports.requestPaymentApproval = functions.https.onCall(async data => {
    const userId: string = data.userId;
    const ownerId: string = data.ownerId;
    const amount: number = data.amount.toFixed(2);

    const objUser = await Global.fetchUser(userId);
    if (null === objUser) {
        throw new functions.https.HttpsError('invalid-argument', 'No user exists');
    }

    try {
        const message = `${objUser.horseManager!.name} does not have the ability to initiate payments on your behalf. Add them as an approved payer to expedite invoice payments. In the meantime, resolve the pending invoice of $${amount} via the payments tab.`;
        const payload = {
            notification: {
                title: 'Request Payment Approval',
                body: message,
                sound: 'default'
            }
        };
        await Global.sendPushNotification(payload, [ownerId]);

        // send email

        return new HLMessageModel('Sent a payment approval request successfully.').toJSON();
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});

exports.requestPayment = functions.https.onCall(async data => {
    const invoiceId: string = data.invoiceId;

    const docInvoice = await db.collection(COLLECTION_INVOICES).doc(invoiceId).get();
    if (!docInvoice.exists) {
        throw new functions.https.HttpsError('not-found', 'No invoice exists');
    }
    const objInvoice = await Global.updateInvoiceInformation(new HLInvoiceModel(docInvoice.id, docInvoice.data()));
    if (!objInvoice.payers) {
        throw new functions.https.HttpsError('not-found', 'No invoice payers exists');
    }

    try {
        const message = `Your invoice of $${objInvoice.amount.toFixed(2)} remains outstanding. Head to the Payments tab to resolve the invoice.`;
        const payload = {
            notification: {
                title: 'Request Payment',
                body: message,
                sound: 'default'
            }
        };
        await Global.sendPushNotification(payload, objInvoice.payers.map(value => value.userId));

        // send email

        return new HLMessageModel('Sent a payment request successfully.').toJSON();
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});

/*
    Payments
 */
exports.markInvoiceAsPaid = functions.https.onCall(async data => {
    const serviceProviderId: string = data.serviceProviderId;
    const invoiceId: string = data.invoiceId;

    const docInvoice = await db.collection(COLLECTION_INVOICES).doc(invoiceId).get();
    if (!docInvoice.exists) {
        throw new functions.https.HttpsError('not-found', 'No invoice exists');
    }
    const objInvoice = await Global.updateInvoiceInformation(new HLInvoiceModel(docInvoice.id, docInvoice.data()));
    if (HLInvoiceStatus.fullPaid === objInvoice.status) {
        throw new functions.https.HttpsError('invalid-argument', 'This invoice has been already paid fully.');
    }

    if (!objInvoice.payers) {
        throw new functions.https.HttpsError('invalid-argument', 'This invoice hasn\'t payers.');
    }

    if (!objInvoice.requests || 0 === objInvoice.requests.length || objInvoice.requests[0].serviceProviderId !== serviceProviderId) {
        throw new functions.https.HttpsError('invalid-argument', 'You are not authorized to mark invoice as paid.');
    }

    try {
        // get all payments of this invoice
        const docPayments = await db.collection(COLLECTION_PAYMENTS).where('invoiceId', '==', invoiceId).get();
        const aryPayments: HLPaymentModel[] = [];
        docPayments.forEach(docPayment => {
            aryPayments.push(new HLPaymentModel(docPayment.id, docPayment.data()));
        });

        // get unpaid payers from invoice
        const aryPaymentPayerIds = aryPayments.map(value => value.payerId);
        const aryUnpaidPayers = objInvoice.payers.filter(value => !aryPaymentPayerIds.includes(value.userId));

        // create payment object manually and update invoice status
        for (const objUnpaidPayer of aryUnpaidPayers) {
            const paymentId = db.collection(COLLECTION_PAYMENTS).doc().id;
            const newPaymentValue = {
                uid: paymentId,
                invoiceId: invoiceId,
                serviceProviderId: serviceProviderId,
                payerId: objUnpaidPayer.userId,
                amount: Global.getAmountWithApplicationFee(objInvoice.amount * (objUnpaidPayer.percentage || 0) / 100),
                tip: Global.getAmountWithApplicationFee(objInvoice.tip * (objUnpaidPayer.percentage || 0) / 100),
                isPaidOutsideApp: true,
                createdAt: Date.now()
            };

            await db.collection(COLLECTION_PAYMENTS).doc(paymentId).set(newPaymentValue);
        }

        // update service request status to paid
        const batch = db.batch();
        objInvoice.requests.forEach(objServiceRequest => {
            const refServiceRequest = db.collection(COLLECTION_SERVICE_REQUESTS).doc(objServiceRequest.uid);
            const updateValue = {
                status: HLServiceRequestStatus.paid,
                updatedAt: Date.now()
            };
            batch.update(refServiceRequest, updateValue);
        });
        await batch.commit();

        const updateInvoiceValue = {
            status: HLInvoiceStatus.fullPaid,
            paidAt: Date.now()
        };
        await db.collection(COLLECTION_INVOICES).doc(invoiceId).update(updateInvoiceValue);

        return new HLMessageModel('Marked as paid your invoice successfully.').toJSON();
    } catch (err) {
        throw new functions.https.HttpsError('internal', err);
    }
});

exports.submitInvoicePayment = functions.https.onCall(async data => {
    const invoiceId: string = data.invoiceId;
    const payerId: string = data.payerId;
    const paymentApproverId: string | undefined = data.paymentApproverId;
    const applePaySource: string | undefined = data.applePaySource;

    let objCharger: HLHorseManagerModel | undefined;

    const objPayer = await Global.fetchUser(payerId);
    if (null === objPayer) {
        throw new functions.https.HttpsError('invalid-argument', 'No payer exists');
    }

    const docPayments = await db.collection(COLLECTION_PAYMENTS)
        .where('payerId', '==', payerId)
        .where('invoiceId', '==', invoiceId)
        .get();
    if (0 < docPayments.docs.length) {
        throw new functions.https.HttpsError('invalid-argument', `A payment has already been made against this invoice for ${objPayer.horseManager!.name}`);
    }

    if (paymentApproverId) {
        const objPaymentApprover = await Global.fetchUser(paymentApproverId);
        if (null === objPaymentApprover) {
            throw new functions.https.HttpsError('invalid-argument', 'No payment approver exists');
        }
        objCharger = objPaymentApprover.horseManager;
    } else {
        objCharger = objPayer.horseManager;
    }

    if (!objCharger || !objCharger.customer || !objCharger.customer.defaultSource) {
        throw new functions.https.HttpsError('invalid-argument', 'No payment method exists');
    }

    const docInvoice = await db.collection(COLLECTION_INVOICES).doc(invoiceId).get();
    if (!docInvoice.exists) {
        throw new functions.https.HttpsError('not-found', 'No invoice exists');
    }
    const objInvoice = await Global.updateInvoiceInformation(new HLInvoiceModel(docInvoice.id, docInvoice.data()));

    if (!objInvoice.requests) {
        throw new functions.https.HttpsError('not-found', 'No invoice requests exists');
    }

    if (!objInvoice.payers) {
        throw new functions.https.HttpsError('not-found', 'No invoice payers exists');
    }
    const payer = objInvoice.payers.find(value => value.userId === payerId);
    if (!payer) {
        throw new functions.https.HttpsError('not-found', 'No invoice payers exists');
    }
    objCharger.percentage = payer.percentage;

    const aryTransfers: HLTransfer[] = [];
    for (const objServiceRequest of objInvoice.requests) {

        if (!objServiceRequest.horse) continue;
        let requestAmount = objServiceRequest.totalAmount();

        // payer is one of owners
        if (!objServiceRequest.horse.leaserId
            && objServiceRequest.horse.ownerIds
            && objServiceRequest.horse.owners
            && objServiceRequest.horse.ownerIds.includes(payerId)) {
            const owner = objServiceRequest.horse.owners.find(value => value.userId === payerId);
            if (!owner) continue;
            requestAmount = requestAmount * (owner.percentage || 0) / 100;
        }
        let objPaymentTransfer: HLServiceProviderModel | undefined;
        if (objServiceRequest.assigner) {
            objPaymentTransfer = objServiceRequest.assigner;
        } else if (objServiceRequest.serviceProvider) {
            objPaymentTransfer = objServiceRequest.serviceProvider;
        }

        if (objPaymentTransfer) {
            const objPaymentTransferUser = await Global.fetchUser(objPaymentTransfer.userId);
            if (null === objPaymentTransferUser) continue;

            objPaymentTransfer = objPaymentTransferUser.serviceProvider;
        }

        if (!objPaymentTransfer
            || !objPaymentTransfer.account) continue;

        const stripeAccountId = objPaymentTransfer.account.id;
        const sameTransfers = aryTransfers.find(value => value.destination === stripeAccountId);
        if (sameTransfers) {
            sameTransfers.amount += Math.floor(requestAmount * 100);
        } else {
            aryTransfers.push({
                userId: objPaymentTransfer.userId,
                amount: Math.floor(requestAmount * 100),
                destination: stripeAccountId
            });
        }
    }

    if (objInvoice.tip && 0 < objInvoice.tip) {
        for (const objServiceRequest of objInvoice.requests) {
            if (!objServiceRequest.serviceProvider
                || !objServiceRequest.serviceProvider.account) continue;
            const stripeAccountId = objServiceRequest.serviceProvider.account.id;
            const sameTransfers = aryTransfers.find(value => value.destination === stripeAccountId);

            const tipAmount = Math.floor(objInvoice.tip * 100 / objInvoice.requests.length);
            if (sameTransfers) {
                sameTransfers.amount += tipAmount;
            } else {
                aryTransfers.push({
                    userId: objServiceRequest.serviceProvider.userId,
                    amount: tipAmount,
                    destination: stripeAccountId
                });
            }
        }
    }
    if (0 === aryTransfers.length) {
        throw new functions.https.HttpsError('invalid-argument', 'Not found service providers');
    }

    try {
        // make stripe payment
        const chargeInvoiceAmount = Global.getAmountWithApplicationFee(objInvoice.amount) * (objCharger.percentage || 0) / 100;
        const chargeInvoiceTip = Global.getAmountWithApplicationFee(objInvoice.tip || 0) * (objCharger.percentage || 0) / 100;

        const chargeAmount = Math.floor((chargeInvoiceAmount + chargeInvoiceTip) * 100);

        let objStripeCharge: Stripe.charges.ICharge;
        if (applePaySource) {
            objStripeCharge = await Stripes.chargeFromApplePay(invoiceId, chargeAmount, applePaySource);
        } else {
            objStripeCharge = await Stripes.chargePayment(invoiceId, chargeAmount, objCharger.customer.id);
        }

        for (const transfer of aryTransfers) {
            await Stripes.transferPayment(invoiceId, transfer.amount, objStripeCharge.id, transfer.destination);
        }

        // create payment
        const paymentId = db.collection(COLLECTION_PAYMENTS).doc().id;
        const newPaymentValue: any = {
            uid: paymentId,
            invoiceId: invoiceId,
            serviceProviderId: objInvoice.requests[0].serviceProviderId,
            payerId: payerId,
            amount: chargeInvoiceAmount,
            tip: chargeInvoiceTip,
            isPaidOutsideApp: false,
            createdAt: Date.now()
        };
        if (paymentApproverId) {
            newPaymentValue.paymentApproverId = paymentApproverId;
        }
        await db.collection(COLLECTION_PAYMENTS).doc(paymentId).set(newPaymentValue);

        // check invoice is fully paid
        const docInvoicePayments = await db.collection(COLLECTION_PAYMENTS).where('invoiceId', '==', invoiceId).get();
        if (docInvoicePayments.docs.length === objInvoice.payers.length) { // full paid
            // update service request status to paid
            const batch = db.batch();
            objInvoice.requests.forEach(objServiceRequest => {
                const refServiceRequest = db.collection(COLLECTION_SERVICE_REQUESTS).doc(objServiceRequest.uid);
                const updateValue = {
                    status: HLServiceRequestStatus.paid,
                    updatedAt: Date.now()
                };
                batch.update(refServiceRequest, updateValue);
            });
            await batch.commit();

            const updateInvoiceValue = {
                status: HLInvoiceStatus.fullPaid,
                paidAt: Date.now()
            };
            await db.collection(COLLECTION_INVOICES).doc(invoiceId).update(updateInvoiceValue);
        }

        // send push notification
        const serviceProviderMessage = `${objCharger.name} has submitted payment`;
        const serviceProviderPayload = {
            notification: {
                title: 'Submitted Payment',
                body: serviceProviderMessage,
                sound: 'default'
            }
        };
        await Global.sendPushNotification(serviceProviderPayload, aryTransfers.map(value => value.userId));

        const horseManagerMessage = `You have completed payment of ${objInvoice.name}`;
        const horseManagerPayload = {
            notification: {
                title: 'Submitted Payment',
                body: horseManagerMessage,
                sound: 'default'
            }
        };
        await Global.sendPushNotification(horseManagerPayload, [objCharger.userId]);

        return new HLMessageModel('Paid invoice successfully.').toJSON();
    } catch (err) {
        throw new functions.https.HttpsError('internal', err.message);
    }
});

/*
APIs
 */
app.get('/stripes/accounts/authorize', (req, res) => APIs.authorizeExpressAccount(req, res));
app.get('/stripes/accounts/token', (req, res) => APIs.getExpressToken(req, res));

exports.api = functions.https.onRequest(app);
