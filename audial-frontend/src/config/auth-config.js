export const AUTH_CONFIG = {
  spotify: {
    clientId: '3226c7189a0b403c9daf846e26cd1221',
    scopes: 'user-read-private user-read-email streaming',
    // Update these URLs based on environment
    redirectUri: process.env.NODE_ENV === 'production' 
      ? 'https://un1t.gg/audial/callback'
      : 'http://localhost:3000/audial/callback',
    baseUrl: process.env.NODE_ENV === 'production'
      ? 'https://un1t.gg/audial'
      : 'http://localhost:3000'
  },
  aws: {
    region: 'us-east-1',
    identityPoolId: 'us-east-1:a60cbe36-1c4f-44bb-a06c-c9c34be2713e'
  }
};