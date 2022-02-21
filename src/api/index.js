const express = require('express')
require('dotenv').config()
const {Pool} = require('pg')
const bodyParser = require('body-parser')
const nearApi = require('near-api-js');
const sha256 = require('js-sha256').sha256;
const fetch = require("node-fetch");
const {NEAR_SOCIAL_APP_TOKEN, NEAR_SOCIAL_CONTRACT_ID, DEFAULT_NETWORK, getConfig} = require('../www/config');
const NEAR_SOCIAL_SERVER_API_V1 = 'https://near.social/api/v1/';
const MESSAGE = 'Future Is NEAR';

const app = express()
const port = 4001
const jsonParser = bodyParser.json();

app.get('/api/challenge', (req, res) => {
    res.send({code: MESSAGE});
})

const GetAccount = async (username) => {
    return generateApiGetRequest(`admin/accounts?username=${username}`, 1)
        .then(accounts => (accounts.length) ? accounts.find(account => account.username === username) : null)
}

const generateResponse = (status, message) => {
    console.log(message);
    return {
        status,
        message
    }
}

const approveAccount = (social_account_id) => {
    return generateApiPostRequest(`admin/accounts/${social_account_id}/approve`, {}, 1).then(result => {
        console.log(result)
        if (!result.hasOwnProperty('error')) {
            return generateApiPostRequest(`accounts/${social_account_id}/confirm_account`, {}, 1);
        }
        else {
            console.log("Approve error " + result.error)
        }
    });
}

const setPassword = (social_account_id, new_password) => {
    return generateApiPostRequest(`accounts/${social_account_id}/set_password`, {password: new_password}, 1);
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
    return generateApiPostRequest(`accounts`, {
        username,
        email: `${username}@near.social`,
        password,
        agreement: true,
        locale: locale || "en"
    }, 1);
};


app.post('/api/verify', jsonParser, async (req, res) => {
    const publicKey = nearApi.utils.key_pair.PublicKey.from(req.body.publicKey);
    const message = new Uint8Array(sha256.array(MESSAGE));
    const signature = new Uint8Array(req.body.signature.split(','));
    let result = publicKey.verify(message, signature);

    if (!!result) {
        const accountId = req.body.account_id;
        const invite = req.body.invite || accountId;

        const nearConfig = getConfig(process.env.NODE_ENV || DEFAULT_NETWORK);
        nearConfig.keyStore = new nearApi.keyStores.InMemoryKeyStore();

        const near = await nearApi.connect(nearConfig);
        const nearAccount = await near.account(accountId);
        const keys = await nearAccount.getAccessKeys();

        if(!accountId.endsWith(".near")) {
            return res.send({
                result: false,
                error: "You can't login with implicit account or without `.near` ending."
            });
        }

        const username = accountId.substr(0, accountId.lastIndexOf("."));
        if (!/^[a-z0-9_]+$/i.test(username)) {
            return res.send({
                result: false,
                error: "Validation failed: Username must contain only letters, numbers and underscores"
            })
        }
        let account = await GetAccount(username);

        let invite_data = await checkInvite(invite, accountId);
        console.log(invite_data)
        if(!account && !invite_data.id) {
            return res.send(generateResponse(false, "Invalid invite code"));
        }
        else {
            if(!account) {
                const spend = await spendInvite(invite_data.id);
                console.log(spend)
            }

            let nearSocialKey = keys.find(key => key.public_key === req.body.publicKey);
            try {
                if (nearSocialKey && nearSocialKey.access_key.permission.FunctionCall.receiver_id === NEAR_SOCIAL_CONTRACT_ID) {
                    // key found

                    // password: 16 chars from end of message signature
                    const password = Buffer.from(signature).toString('base64').substr(70, 16);
                    console.log(password)

                    if (!!account) {
                        if (!account?.approved) {
                            let result = await approveAccount(account.id);
                            if (!result.hasOwnProperty('error')) {
                                console.log(`Account ${username} approved`);
                            }
                            console.log(result)
                            res.send(generateResponse(true, JSON.stringify({username})));
                        } else {
                            await setPassword(account.id, password);
                            console.log(`Password for account ${username}/${account.id} updated to ${password}`);
                            res.send(generateResponse(true, JSON.stringify({username})));
                        }
                    } else {
                        let result = await CreateAccount(username, password);
                        console.log(result)
                        if (result.hasOwnProperty("error")) {
                            return res.send(generateResponse(false, result.error));
                        } else {
                            console.log(`Account ${username} created`);
                            let account = await GetAccount(username);
                            console.log(`Account approval status: ${account?.approved}`);
                            if (!!account && !account?.approved) {
                                result = await approveAccount(account.id);
                                if (!result.hasOwnProperty('error')) {
                                    console.log(`Account ${username}/${account.id} approved`);
                                }
                                console.log(result)
                                res.send(generateResponse(true, JSON.stringify({username})));
                            }
                        }
                    }
                }
            }
            catch (err) {
                console.log(`Key error ${err.message}`);
                res.send(generateResponse(false, err.message));
            }
        }
    } else {
        res.send({result})
    }
})

const getPool = () => {
    return new Pool({
        user: process.env.POSTGRES_USER,
        host: process.env.POSTGRES_SERVICE_HOST,
        database: process.env.POSTGRES_DB,
        password: process.env.POSTGRES_PASSWORD,
        port: process.env.POSTGRES_SERVICE_PORT,
    });
}

app.get('/api/init', (req, res) => {
    getPool().query(`CREATE TABLE IF NOT EXISTS invites (
        id BIGSERIAL PRIMARY KEY,
        code VARCHAR(255) NOT NULL,
        account_id VARCHAR(255),
        attempts NUMERIC NOT NULL CHECK (attempts >= 0),
        creator VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
        )`);

    res.send("Ok");
})


app.post('/api/check-invite', jsonParser, (req, res) => {
    checkInvite(req.body.invite, req.body.account_id)
        .then(data => res.send(data));
})

const checkInvite = (invite, account_id) => {
    console.log({invite, account_id});
    return new Promise(function(resolve, reject) {
        const pool = getPool();
        pool.query(`SELECT id FROM invites
                    WHERE
                        code = $1::varchar AND 
                      (account_id = $2::varchar OR account_id IS NULL)
                      AND attempts > 0`, [invite, account_id], (error, results) => {
            if (error) {
                reject(error)
            }
            resolve({id: parseInt(results.rows[0]?.id) || 0})
        })
    })
}

const spendInvite = (invite_id) => {
    console.log(`spendInvite: ${invite_id}`);
    return new Promise(function(resolve, reject) {
        const pool = getPool();
        pool.query(`UPDATE invites
                    SET attempts = attempts - 1
                    WHERE id = $1`, [invite_id], (error, results) => {
            if (error) {
                reject(error)
            }
            resolve(results)
        })
    })
}

app.post('/api/account-exists', jsonParser, async (req, res) => {
    let accountId = req.body.account_id;
    const username = accountId.substr(0, accountId.lastIndexOf("."));
    let account = await GetAccount(username);

    res.send(generateResponse(!!account, JSON.stringify({approved: account?.approved})));
})

app.listen(port, () => console.log(`NEAR Social Auth Backend listening on port ${port}!`))