import React, {Component} from 'react'
import * as nearApi from 'near-api-js';
import {sha256} from 'js-sha256';
import {parse} from "query-string"
import ReactCanvasConfetti from "react-canvas-confetti";
import {NEAR_SOCIAL_CONTRACT_ID, DEFAULT_NETWORK, getConfig} from './config'
import './App.css'


class App extends Component {
    state = {
        isLoggedIn: false,
        invite: '',
        inviteFound: false,
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

        const invite = parse(window.location.search)?.invite;
        if (invite) {
            this.setState({invite});
            await this.checkInvite(invite)
        }

        //await this.nearAuth();
    }

    sign = async (text) => {
        const account = (await this.getWallet()).account();
        const keyStore = account.connection.signer.keyStore;
        const privateKey = keyStore.localStorage[`${keyStore.prefix}${window.accountId}:${account.connection.networkId}`];
        if(privateKey) {
            const keyPair = new nearApi.utils.key_pair.KeyPairEd25519(privateKey.substring("ed25519:".length));
            const message = new Uint8Array(sha256.array(text));
            const signature = keyPair.sign(message);
            return {signature};
        }
        else {
            return {}
        }
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
                            account_id: window.accountId,
                            invite: this.state.invite
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

    loginToSocial = async () => {
        console.log(this.state)
        if(!this.state.isRegistrationComplete) {
            const {isRegistrationComplete, registrationUsername, registrationSignature} = await this.nearAuth();
            this.state.registrationSignature = registrationSignature;
            this.state.registrationUsername = registrationUsername;
            this.state.isRegistrationComplete = isRegistrationComplete;
        }

        if(this.state.isRegistrationComplete) {
            const form = document.createElement("form");
            form.classList.add("hidden");
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
    }

    nearAuth = async () => {
        return this.challenge().then(({response, signature}) => {
            console.log(response)
                if (response.status) {
                    let data = JSON.parse(response.message);
                    if (data.username) {
                        this.fire()
                        const userData = {
                            isRegistrationComplete: true,
                            registrationUsername: data.username,
                            registrationSignature: signature.signature.toString(),
                            isAccountExists: true,
                        };
                        this.setState(userData);
                        return (userData);
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
            }
        }
        return window.walletConnection;
    }

    getConfig = () => {
        const nearConfig = getConfig(process.env.NODE_ENV || DEFAULT_NETWORK)

        nearConfig.keyStore = new nearApi.keyStores.BrowserLocalStorageKeyStore();

        return nearConfig;
    }

    checkInvite = async (invite) => {
        await window
            .fetch(`/api/check-invite`, {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    invite: invite || this.state.invite,
                    account_id: window.accountId
                })
            })
            .then(res => res.json())
            .then(async data => {
                this.setState({inviteFound: (data.id > 0)})
                console.log(data)
            });

    }

    render() {
        return (
            <div className="App">
                <header className="App-header">
                    <h1>NEAR Social Auth</h1>
                </header>

                {!this.state.isAccountExists &&
                    <div className="invite-block">
                        <div>
                            Your invite: <input type="textbox" className="invite" value={this.state.invite}
                                                onChange={this.handleInviteChange}/>
                        </div>
                    </div>
                }

                    {!this.state.isLoggedIn &&
                        <>
                            <button onClick={this.nearLogin} className="App-button">
                                Login With Near Wallet
                            </button>
                        </>
                    }

                    {this.state.isLoggedIn  &&
                        <>
                            {(this.state.isAccountExists || (this.state.inviteFound && this.state.isRegistrationComplete)) &&
                                <div>
                                    <button onClick={this.loginToSocial} className="App-button">
                                        Login to NEAR Social
                                    </button>
                                </div>
                            }

                            {this.state.inviteFound && !this.state.isRegistrationComplete && !this.state.isAccountExists &&
                                <div>
                                    <button onClick={this.nearAuth} className="App-button">
                                        Create NEAR Social Account
                                    </button>
                                </div>
                            }

                            <ReactCanvasConfetti
                                refConfetti={this.getInstance}
                                style={canvasStyles}
                            />

                            {!this.state.inviteFound && this.state.invite && !this.state.isAccountExists &&
                                <div>Invite is invalid</div>
                            }

                            {this.state.isAccountExists && <>
                                <hr/>
                                <div>Your account: <strong>{this.state.userAccount}</strong></div>
                                <div>
                                    Password <code className="social-password">{this.state.userPassword}</code>
                                    <button onClick={this.getPassword} className="App-button-small">Reveal</button>
                                </div>
                            </>}

                            <div className="log-out">
                                <button onClick={this.nearLogout} className="App-button">
                                    Logout
                                </button>
                            </div>
                        </>
                    }
            </div>
        )
    }

    handleInviteChange = async (e) => {
        this.setState({invite: e.target.value})
        await this.checkInvite(e.target.value)
    }

    makeShot = (particleRatio, opts) => {
        this.animationInstance &&
        this.animationInstance({
            ...opts,
            origin: { y: 0.7 },
            particleCount: Math.floor(200 * particleRatio)
        });
    };

    fire = () => {
        this.makeShot(0.25, {
            spread: 26,
            startVelocity: 55
        });

        this.makeShot(0.2, {
            spread: 60
        });

        this.makeShot(0.35, {
            spread: 100,
            decay: 0.91,
            scalar: 0.8
        });

        this.makeShot(0.1, {
            spread: 120,
            startVelocity: 25,
            decay: 0.92,
            scalar: 1.2
        });

        this.makeShot(0.1, {
            spread: 120,
            startVelocity: 45
        });
    };

    getInstance = (instance) => {
        this.animationInstance = instance;
    };
}

const canvasStyles = {
    position: "fixed",
    pointerEvents: "none",
    width: "100%",
    height: "100%",
    top: 0,
    left: 0
};

export default App
