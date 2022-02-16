const express = require('express')
require('dotenv').config()
const {Pool} = require('pg')
const bodyParser = require('body-parser')
const nearApi = require('near-api-js');
const sha256 = require('js-sha256').sha256;
const fetch = require("node-fetch");
const {NEAR_SOCIAL_CONTRACT_ID, getConfig} = require('../www/config');
const NEAR_SOCIAL_SERVER_API_V1 = 'https://near.social/api/v1/';
const NEAR_SOCIAL_APP_TOKEN = '_IYKKmRoU8pQeYWC8jLvdJ7SakH5xTs1z9IClMYDBXs';
const MESSAGE = 'Future Is NEAR';

const app = express()
const port = 4321
const jsonParser = bodyParser.json();

app.get('/api/challenge', (req, res) => {
    res.send({code: MESSAGE});
})

const GetAccount = async (username) => {
    return generateApiGetRequest(`admin/accounts?username=${username}`, 1)
        .then(accounts => accounts.find(account => account.username === username))
}

const generateResponse = (status, message) => {
    console.log(message);
    return {
        status,
        message
    }
}

const ApproveAccount = (social_account_id) => {
    return generateApiPostRequest(`admin/accounts/${social_account_id}/approve`, {}, 1);
}

const generateApiPostRequest = (endpoint, data, api_version) => {
    const fetchInit = {
        method: 'POST',
        headers: generateApiHeaders(),
        body: generateApiBody(data)
    }

    return fetch(GetApiUrl(endpoint, api_version), fetchInit).then(res => res.json());
}

const generateApiGetRequest = (endpoint, api_version) => {
    console.log("API GET Request: " + endpoint)
    const fetchInit = {
        method: 'GET',
        headers: generateApiHeaders()
    }

    return fetch(GetApiUrl(endpoint, api_version), fetchInit)
        .then(res => !!api_version ? res.json() : res.text());
}

const GetApiUrl = (endpoint, api_version) => {
    if (api_version === 1){
        endpoint = NEAR_SOCIAL_SERVER_API_V1 + endpoint;
    }
    return endpoint;
}

const generateApiHeaders = () => {
    const headers = new fetch.Headers();
    headers.set('Authorization', 'Bearer ' + NEAR_SOCIAL_APP_TOKEN);
    return headers;
}

const generateApiBody = (data) => {
    const body = new URLSearchParams()
    for (let key in data) {
        body.set(key, data[key])
    }
    return body;
}

const CreateAccount = async (username, password, locale) => {
    /// TODO Refactor
    const fetchHeaders = new fetch.Headers();
    fetchHeaders.set('Authorization', 'Bearer ' + NEAR_SOCIAL_APP_TOKEN);

    const body = new URLSearchParams()

    const data = {
        username,
        email: `${username}@near.social`,
        password,
        agreement: true,
        locale: locale || "en"
    };

    for (let key in data) {
        body.set(key, data[key])
    }

    const endpoint = 'accounts';

    const fetchInit = {
        method: 'POST',
        headers: fetchHeaders,
        body: body
    }

    return await fetch(NEAR_SOCIAL_SERVER_API_V1 + endpoint, fetchInit).then(res => res.json());
};


app.post('/api/verify', jsonParser, async (req, res) => {
    const publicKey = nearApi.utils.key_pair.PublicKey.from(req.body.publicKey);
    const message = new Uint8Array(sha256.array(MESSAGE));
    const signature = new Uint8Array(req.body.signature.split(','));
    let result = publicKey.verify(message, signature);

    if (result) {
        let accountId = req.body.account_id;
        const nearConfig = getConfig(process.env.NODE_ENV || 'development');
        nearConfig.keyStore = new nearApi.keyStores.InMemoryKeyStore();

        const near = await nearApi.connect(nearConfig);
        const account = await near.account(accountId);
        const keys = await account.getAccessKeys();

        let nearSocialKey = keys.find(key => key.public_key === req.body.publicKey);
        if (nearSocialKey.access_key.permission.FunctionCall.receiver_id === NEAR_SOCIAL_CONTRACT_ID) {
            // key found

            const username = accountId.substr(0, accountId.lastIndexOf("."));
            if (!/^[a-z0-9_]+$/i.test(username)) {
                res.send({result: false, error: "Validation failed: Username must contain only letters, numbers and underscores"})
            }

            // password: 16 chars from end of message signature
            const password = Buffer.from(signature).toString('base64').substr(70, 16);
            console.log(password)

            let account = await GetAccount(username);
            console.log(account)
            if (!!account){
                if(!account?.approved){
                    await ApproveAccount(account.id);
                    res.send(generateResponse(true, JSON.stringify({username})));
                }
                else {
                    res.send(generateResponse(true, JSON.stringify({username})));
                }
            }
            else {
                let result = await CreateAccount(username, password);
                console.log(`Account ${username} created`);
                let account = GetAccount(username);
                if(!account?.approved){
                    await ApproveAccount(account.id);
                    console.log(`Account ${username} approved`);
                    res.send(generateResponse(true, JSON.stringify({username})));
                }
            }
        }
    } else {
        res.send({result})
    }
})

/*
app.get('/api/count', (req, res) => {
    const pool = new Pool({
        user: process.env.POSTGRES_USER,
        host: process.env.POSTGRES_SERVICE_HOST,
        database: process.env.POSTGRES_DB,
        password: process.env.POSTGRES_PASSWORD,
        port: process.env.POSTGRES_SERVICE_PORT,
    })

    pool.query('SELECT count(*) AS count FROM clicks', (error, results) => {
        if (error) {
            throw error
        }
        res.send({count: results.rows[0].count || 0})
    })
})
 */

app.post('/api/account-exists', jsonParser, async (req, res) => {
    console.log(req)
    let accountId = req.body.account_id;
    const username = accountId.substr(0, accountId.lastIndexOf("."));
    let account = await GetAccount(username);

    console.log(username)
    console.log(account)

    res.send(generateResponse(!!account, ""));
})

app.listen(port, () => console.log(`NEAR Social Auth Backend listening on port ${port}!`))
