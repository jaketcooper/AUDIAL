// src/auth/AuthProvider.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
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
    console.log('Starting token exchange with:', {
        code: code.substring(0, 10) + '...', // Don't log full code
        codeVerifier: codeVerifier.substring(0, 10) + '...',
        redirectUri: AUTH_CONFIG.spotify.redirectUri
    });
    try {
      setError(null);
      setIsLoading(true);

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
        const errorText = await tokenResponse.text();
        console.error('Token exchange failed with:', errorText);
        throw new Error(`Token exchange failed: ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      setSpotifyToken(tokenData.access_token);

      // Validate token with your Lambda
      const validationResponse = await fetch('https://m3br67dc5v4b2xbg3ytdshh6wy0sqokr.lambda-url.us-east-1.on.aws/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: tokenData.access_token
        })
      });

      console.log('Lambda response status:', validationResponse.status);
      const validationText = await validationResponse.text();
      console.log('Lambda response body:', validationText);

      if (!validationResponse.ok) {
        throw new Error(`Token validation failed: ${validationText}`);
      }

      const validationData = JSON.parse(validationText);
      console.log('Parsed validation data:', validationData);

      const credentials = await fromCognitoIdentityPool({
        client: cognitoIdentityClient,
        identityPoolId: AUTH_CONFIG.aws.identityPoolId,
        customRoleArn: undefined,  // Add this
        logins: {
          'accounts.spotify.com': validationData.token
        }
      });

      setCredentials(credentials);
      setIsAuthenticated(true);

      const userResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`
        }
      });

      if (!userResponse.ok) {
        throw new Error('Failed to fetch user profile');
      }

      const userData = await userResponse.json();
      setUserId(userData.id);
      
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