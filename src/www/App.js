import React, {Component} from 'react'
import * as nearApi from 'near-api-js';
import {sha256} from 'js-sha256';
import {NEAR_SOCIAL_CONTRACT_ID, DEFAULT_NETWORK, getConfig} from './config'
import './App.css'


class App extends Component {
    state = {
        isLoggedIn: false,
        isAccountExists: false,
        isAccountApproved: false,
        isRegistrationComplete: false,
        registrationUsername: '',
        registrationSignature: '',
        userAccount: 'Unknown',
        userPassword: '****************'
    }

    componentDidMount = async () => {
        const wallet = await this.getWallet();
        if (wallet.isSignedIn()) {
            this.setState({
                isLoggedIn: true
            })
        }
    }

    sign = async (text) => {
        const account = (await this.getWallet()).account();
        const keyStore = account.connection.signer.keyStore;
        const privateKey = keyStore.localStorage[`${keyStore.prefix}${window.accountId}:${account.connection.networkId}`];
        const keyPair = new nearApi.utils.key_pair.KeyPairEd25519(privateKey.substring("ed25519:".length));
        const message = new Uint8Array(sha256.array(text));
        const signature = keyPair.sign(message);
        return {signature};
    }

    challenge = async () => {
        const {response, signature} = await window
            .fetch(`/api/challenge`)
            .then(res => res.json())
            .then(async result => {
                const {signature} = await this.sign(result.code);
                const response = await window
                    .fetch(`/api/verify`, {
                        method: 'POST',
                        cache: 'no-cache',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            signature: signature.signature.toString(),
                            publicKey: signature.publicKey.toString(),
                            account_id: window.accountId
                        })
                    })
                    .then(res => res.json())
                return {response, signature};
            })

        return {response, signature};
    }

    nearLogin = async () => {
        const wallet = await this.getWallet();
        await wallet.requestSignIn(
            NEAR_SOCIAL_CONTRACT_ID,
            "NEAR Social",
            //"http://YOUR-URL.com/success", // optional
            //"http://YOUR-URL.com/failure" // optional
        );
    }

    getPassword = async () => {
        await window
            .fetch(`/api/challenge`)
            .then(res => res.json())
            .then(async result => {
                const {signature} = await this.sign(result.code);
                this.setState({
                    userPassword: this.generatePassword(signature)
                })
            });

    }

    isAccountExists = async (account_id) => {
        return await window
            .fetch(`/api/account-exists`, {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    account_id: account_id
                })
            })
            .then(res => res.json())
            .then(res => {
                return {status: res.status, approved: JSON.parse(res.message)?.approved}
            });
    }

    generatePassword = (signature) => {
        return Buffer.from(new Uint8Array(signature.signature.toString().split(','))).toString('base64').substr(70, 16)
    }

    loginToSocial = () => {
        const form = document.createElement("form");
        const email = document.createElement("input");
        email.value = `${this.state.registrationUsername}@near.social`;
        email.name = "user[email]";
        email.type = "email";
        const password = document.createElement("input");
        password.value = Buffer.from(new Uint8Array(this.state.registrationSignature.split(','))).toString('base64').substr(70, 16);
        password.name = "user[password]";
        password.type = "password";
        form.action = "https://near.social/auth/sign_in";
        form.method = "POST";
        form.name = "sign-in";
        form.appendChild(email);
        form.appendChild(password);
        document.body.appendChild(form);

        if (document.forms['sign-in']) { // when form is present
            //console.log(password)
            document.forms['sign-in'].submit();
        }
    }

    nearAuth = async () => {
        this.challenge().then(({response, signature}) => {
                if (response.status) {
                    let data = JSON.parse(response.message);
                    if (data.username) {
                        this.setState({
                            isRegistrationComplete: true,
                            registrationUsername: data.username,
                            registrationSignature: signature.signature.toString()
                        });
                    }
                }
            }
        )
    }

    nearLogout = async () => {
        const wallet = await this.getWallet();
        wallet.signOut();
        window.location.reload(false);
    }

    getWallet = async () => {
        if (!window?.walletConnection) {
            const near = await nearApi.connect(this.getConfig());
            window.walletConnection = new nearApi.WalletConnection(near, 'near-social');
            window.accountId = window.walletConnection.getAccountId();

            if (window.accountId) {
                const {status, approved} = await this.isAccountExists(window.accountId);
                this.setState({
                    userAccount: window.accountId.substr(0, window.accountId.lastIndexOf(".")) + "@near.social",
                    isAccountExists: status,
                    isAccountApproved: approved
                })

                await this.nearAuth()
            }
        }
        return window.walletConnection;
    }

    getConfig = () => {
        const nearConfig = getConfig(process.env.NODE_ENV || DEFAULT_NETWORK)

        nearConfig.keyStore = new nearApi.keyStores.BrowserLocalStorageKeyStore();

        return nearConfig;
    }

    render() {
        return (
            <div className="App">
                <header className="App-header">

                    <h1>NEAR Social Auth</h1>

                    {!this.state.isLoggedIn &&
                        <>
                            <button onClick={this.nearLogin} className="App-button">
                                Login With Near Wallet
                            </button>
                        </>
                    }

                    {this.state.isLoggedIn &&
                        <>
                            <button onClick={this.loginToSocial} className="App-button" disabled={!this.state.isRegistrationComplete} >
                                Login to NEAR Social
                            </button>

                            {/*
                            <button onClick={this.nearLogout} className="App-button">
                                Logout
                            </button>
                            */}

                            {this.state.isAccountExists && <>
                                <hr/>
                                <div>Your account: <strong>{this.state.userAccount}</strong></div>
                                <div>
                                    Password <code className="social-password">{this.state.userPassword}</code>
                                    <button onClick={this.getPassword} className="App-button-small">Reveal</button>
                                </div>
                            </>}
                        </>
                    }
                </header>
            </div>
        )
    }
}

export default App
