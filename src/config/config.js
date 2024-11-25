// src/config/config.js
const ENV = {
  development: {
    baseUrl: 'http://un1t.gg',  // Removed trailing slash
    callbackPath: '/audial/callback'
  },
  production: {
    baseUrl: 'http://un1t.gg',  // Removed trailing slash
    callbackPath: '/audial/callback'
  }
};

const environment = process.env.NODE_ENV || 'development';
const envConfig = ENV[environment];

export const CONFIG = {
  spotify: {
    clientId: '3226c7189a0b403c9daf846e26cd1221',
    scopes: 'user-read-private user-read-email streaming',
    redirectUri: `${envConfig.baseUrl}${envConfig.callbackPath}`,
    baseUrl: `${envConfig.baseUrl}/audial`
  },
  aws: {
    region: 'us-east-1',
    identityPoolId: 'us-east-1:a60cbe36-1c4f-44bb-a06c-c9c34be2713e'
  },
  api: {
    validateTokenEndpoint: 'https://alfbh3l2k4.execute-api.us-east-1.amazonaws.com/dev/validate-token'
  }
};