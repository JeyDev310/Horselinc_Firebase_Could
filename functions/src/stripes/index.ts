import * as functions from 'firebase-functions'
import * as Stripe from 'stripe'
import {HLUserModel} from "../models/users";

// stripes config
const stripe = new Stripe(functions.config().stripe.secret_key);
const currency = 'usd';

/*
Customer
 */
export function createStripeCustomer(objUser: HLUserModel) {
    const options: any = {
        email: objUser.email,
        description: 'HorseLinc Customer'
    };
    if (objUser.horseManager) {
        options.name = objUser.horseManager.name;
        if (null !== objUser.horseManager.phone) {
            options.phone = objUser.horseManager.phone;
        }
    }

    return stripe.customers.create(options);
}

export function retrieveCustomer(customerId: string) {
    return stripe.customers.retrieve(customerId);
}

export function deleteCustomer(customerId: string) {
    return stripe.customers.del(customerId);
}

export function addSourceToCustomer(customerId: string, sourceId: string) {
    return stripe.customers.createSource(customerId, {source: sourceId});
}

export function deleteSourceFromCustomer(customerId: string, sourceId: string) {
    return stripe.customers.deleteSource(customerId, sourceId)
}

export function updateDefaultSource(customerId: string, sourceId: string) {
    return stripe.customers.update(customerId, {
        default_source: sourceId
    });
}

/*
Account
 */
export function createExpressLoginLink(accountId: string) {
    return stripe.accounts.createLoginLink(accountId);
}

export function retrieveAccount(accountId: string) {
    return stripe.accounts.retrieve(accountId);
}

export function rejectAccount(accountId: string) {
    return stripe.accounts.reject(accountId, {
        reason: 'fraud'
    });
}

/*
    Charges
 */
export function chargePayment(invoiceId: string, amount: number, customerId: string) {
    return stripe.charges.create({
        amount: amount,
        currency: currency,
        customer: customerId,
        transfer_group: invoiceId
    });
}

export function chargeFromApplePay(invoiceId: string, amount: number, sourceId: string) {
    return stripe.charges.create({
        amount: amount,
        currency: currency,
        source: sourceId,
        transfer_group: invoiceId
    });
}

export function transferPayment(invoiceId: string, amount: number, chargeId: string, accountId: string) {
    return stripe.transfers.create({
        amount: amount,
        currency: currency,
        source_transaction: chargeId,
        destination: accountId,
        transfer_group: invoiceId
    });
}