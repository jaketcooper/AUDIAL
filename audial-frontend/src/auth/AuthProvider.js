// src/auth/AuthProvider.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentity } from "@aws-sdk/credential-provider-cognito-identity";
import sha256 from 'crypto-js/sha256';
import Base64 from 'crypto-js/enc-base64';
import Hex from 'crypto-js/enc-hex';

const AuthContext = createContext(null);

// Configuration
const AUTH_CONFIG = {
  spotify: {
    clientId: '3226c7189a0b403c9daf846e26cd1221',
    scopes: 'user-read-private user-read-email streaming',
    redirectUri: 'http://3.213.192.126/audial/callback',
    baseUrl: 'http://3.213.192.126/audial'
  },
  aws: {
    region: 'us-east-1',
    identityPoolId: 'us-east-1:a60cbe36-1c4f-44bb-a06c-c9c34be2713e'
  }
};

const generateRandomString = (length) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = new Uint8Array(length);
  window.crypto.getRandomValues(values);
  return Array.from(values)
    .map(x => possible.charCodeAt(x % possible.length))
    .map(x => String.fromCharCode(x))
    .join('');
};

const generateCodeChallenge = (codeVerifier) => {
  try {
    console.log('Generating challenge for verifier:', codeVerifier);
    const hashed = sha256(codeVerifier);
    const encoded = Base64.stringify(hashed)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    console.log('Generated challenge:', encoded);
    return encoded;
  } catch (error) {
    console.error('Error generating challenge:', error);
    throw error;
  }
};

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [spotifyToken, setSpotifyToken] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const cognitoIdentityClient = new CognitoIdentityClient({
    region: AUTH_CONFIG.aws.region,
  });

  const checkAuthCode = async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    
    if (code) {
      const codeVerifier = sessionStorage.getItem('codeVerifier');
      if (codeVerifier) {
        try {
          // Clear the code from sessionStorage to prevent duplicate attempts
          sessionStorage.removeItem('codeVerifier');
          await handleCallback(code, codeVerifier);
        } catch (error) {
          console.error('Auth callback error:', error);
          setError(error.message);
        }
      }
      // Clean up URL after handling code
      window.history.replaceState(
        {}, 
        document.title, 
        AUTH_CONFIG.spotify.baseUrl
      );
    }
  };

  const refreshSession = async () => {
    const refreshToken = localStorage.getItem('spotify_refresh_token');
    if (!refreshToken) return false;
    try {
      // Implement refresh token logic here
      return true;
    } catch (error) {
      console.error('Session refresh error:', error);
      return false;
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      await checkAuthCode();
      setIsLoading(false);
    };
    initAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initiateLogin = () => {
    try {
      console.log('Initial redirect URI:', AUTH_CONFIG.spotify.redirectUri);
      setError(null);
      
      const codeVerifier = generateRandomString(128);
      console.log('Generated verifier:', codeVerifier);
      
      const codeChallenge = generateCodeChallenge(codeVerifier);
      console.log('Generated challenge:', codeChallenge);
      
      sessionStorage.setItem('codeVerifier', codeVerifier);

      const params = new URLSearchParams({
        client_id: AUTH_CONFIG.spotify.clientId,
        response_type: 'code',
        redirect_uri: AUTH_CONFIG.spotify.redirectUri,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        scope: AUTH_CONFIG.spotify.scopes,
      });

      window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
    } catch (error) {
      console.error('Login initiation error:', error);
      setError('Failed to initiate login process');
    }
  };

  const handleCallback = async (code, codeVerifier) => {
    try {
      setError(null);
      setIsLoading(true);

      // Exchange code for token
      const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: AUTH_CONFIG.spotify.clientId,
          grant_type: 'authorization_code',
          code,
          redirect_uri: AUTH_CONFIG.spotify.redirectUri,
          code_verifier: codeVerifier,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Token exchange failed');
      }

      const tokenData = await tokenResponse.json();
      setSpotifyToken(tokenData.access_token);

      // Validate token and get Cognito token
      const validationResponse = await fetch('https://m3br67dc5v4b2xbg3ytdshh6wy0sqokr.lambda-url.us-east-1.on.aws/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: tokenData.access_token
        })
      });

      if (!validationResponse.ok) {
        const errorText = await validationResponse.text();
        throw new Error(`Token validation failed: ${errorText}`);
      }

      const validationData = await validationResponse.json();
      console.log('Validation data:', validationData);

      // Store Spotify token for API calls
      setSpotifyToken(validationData.token); // Use 'token' from validationData

      // Get AWS credentials using Cognito token
      const getCredentials = async () => {
        const identityId = validationData.identityId;
        const openIdToken = validationData.cognitoToken;

        const loginMap = {
          'cognito-identity.amazonaws.com': openIdToken
        };
        console.log('Trying to get credentials with identityId and logins:', identityId, loginMap);

        return await fromCognitoIdentity({
          client: cognitoIdentityClient,
          identityId: identityId,
          logins: loginMap
        });
      };

      // Then use it:
      try {
        const credentials = await getCredentials();
        console.log('Successfully obtained credentials:', credentials);
        setCredentials(credentials);
        setIsAuthenticated(true);
        setUserId(validationData.userId);
      } catch (error) {
        console.error('Failed to authenticate:', error);
        setError('Failed to obtain AWS credentials');
      }

      // Store refresh token if provided
      if (tokenData.refresh_token) {
        localStorage.setItem('spotify_refresh_token', tokenData.refresh_token);
      }

    } catch (error) {
      console.error('Callback handling error:', error);
      setError('Authentication failed');
      setIsAuthenticated(false);
      setCredentials(null);
      setSpotifyToken(null);
      setUserId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setIsAuthenticated(false);
    setCredentials(null);
    setSpotifyToken(null);
    setUserId(null);
    setError(null);
    sessionStorage.removeItem('codeVerifier');
    localStorage.removeItem('spotify_refresh_token');
  };

  return (
    <AuthContext.Provider 
      value={{
        isAuthenticated,
        credentials,
        spotifyToken,
        userId,
        isLoading,
        error,
        login: initiateLogin,
        logout,
        refreshSession
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};