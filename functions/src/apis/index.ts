import * as functions from 'firebase-functions'
import * as express from 'express'
import * as httpRequest from 'request'
import * as Stripes from '../stripes/index'
import * as Global from '../globals'
import {db} from "../index";
import {HLStripeAccountModel} from "../models/users";
import {COLLECTION_USERS} from "../constants";

// Express
export async function authorizeExpressAccount(req: express.Request, res: express.Response) {
    req.session!.userId = req.query.userId;
    req.session!.state = Math.random().toString(36).slice(2);

    const params: any = {
        redirect_uri: functions.config().stripe.redirect_uri,
        client_id: functions.config().stripe.client_id,
        state: req.session!.state
    };

    const objUser = await Global.fetchUser(req.query.userId);
    if (null !== objUser) {
        params['stripe_user[email]'] = objUser.email;

        if (objUser.serviceProvider) {
            const firstName = objUser.serviceProvider.subName(0);
            const lastName = objUser.serviceProvider.subName(1);
            if (firstName) {
                params['stripe_user[first_name]'] = firstName;
            }
            if (lastName) {
                params['stripe_user[last_name]'] = lastName;
            }
            params['stripe_user[phone_number]'] = objUser.serviceProvider.phone;
        }
    }
    const queryString = Object.keys(params).map(key => key + '=' + params[key]).join('&');
    const authorizeUri = functions.config().stripe.authorize_uri + '?' + queryString;

    console.log('Authorize Uri =>', authorizeUri);

    res.redirect(authorizeUri);
}

export function getExpressToken(req: express.Request, res: express.Response) {
    if (undefined === req.session) {
        res.redirect('horse-linc://error?message=Server error occurred.');
        return;
    }

    if (req.session.state !== req.query.state) {
        res.redirect('horse-linc://error?message=Failed to create a stripe express account. Please try again later.');
    } else {
        const userId = req.session.userId;

        const options = {
            uri: functions.config().stripe.token_uri,
            form: {
                grant_type: 'authorization_code',
                client_secret: functions.config().stripe.secret_key,
                code: req.query.code
            }
        };

        httpRequest.post(options, async function (err, response, body) {
            const result = JSON.parse(body);
            console.log('Token Response =>', body);

            if (200 === response.statusCode) {
                const accountId = result.stripe_user_id;
                const account = await Stripes.retrieveAccount(accountId);
                const objAccount = new HLStripeAccountModel(account, true);
                await db.collection(COLLECTION_USERS).doc(userId).update({
                    'serviceProvider.account': objAccount.toJSON()
                });
                res.redirect(`horse-linc://success?account_id=${result.stripe_user_id}`);
            } else {
                res.redirect(`horse-linc://error?message=${result.error_description}`);
            }
        });
    }
}