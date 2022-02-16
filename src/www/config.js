const NEAR_SOCIAL_CONTRACT_ID = "social.near";
const DEFAULT_NETWORK = "mainnet";

function getConfig(env) {
    switch (env) {
        case 'production':
        case 'mainnet':
            return {
                networkId: 'mainnet',
                nodeUrl: 'https://rpc.mainnet.near.org',
                walletUrl: 'https://wallet.near.org',
                helperUrl: 'https://helper.mainnet.near.org',
                headers: {}
            }
        case 'development':
        case 'testnet':
            return {
                networkId: 'testnet',
                nodeUrl: 'https://rpc.testnet.near.org',
                walletUrl: 'https://wallet.testnet.near.org',
                helperUrl: 'https://helper.testnet.near.org',
                headers: {}
            }
        default:
            throw Error(`Unconfigured environment '${env}'. Can be configured in src/config.js.`)
    }
}

module.exports = {NEAR_SOCIAL_CONTRACT_ID, DEFAULT_NETWORK, getConfig}