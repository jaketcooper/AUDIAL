// src/auth/AuthProvider.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentity } from "@aws-sdk/credential-provider-cognito-identity";
import sha256 from 'crypto-js/sha256';
import Base64 from 'crypto-js/enc-base64';

const AuthContext = createContext(null);

const AUTH_CONFIG = {
  spotify: {
    clientId: '3226c7189a0b403c9daf846e26cd1221',
    scopes: 'user-read-private user-read-email streaming',
    redirectUri: 'http://un1t.gg/audial/callback',
    baseUrl: 'http://un1t.gg/audial'
  },
  aws: {
    region: 'us-east-1',
    identityPoolId: 'us-east-1:a60cbe36-1c4f-44bb-a06c-c9c34be2713e'
  }
};

// Secure storage keys
const STORAGE_KEYS = {
  REFRESH_TOKEN: 'spotify_refresh_token',
  EXPIRATION: 'token_expiration',
  USER_ID: 'user_id'
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
    const hashed = sha256(codeVerifier);
    return Base64.stringify(hashed)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (error) {
    console.error('Error generating code challenge');
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
  const [tokenRefreshTimeout, setTokenRefreshTimeout] = useState(null);

  const cognitoIdentityClient = new CognitoIdentityClient({
    region: AUTH_CONFIG.aws.region,
  });

  const refreshSpotifyToken = async () => {
    const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: AUTH_CONFIG.spotify.clientId,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh token');
    }

    const tokenData = await response.json();
    return tokenData;
  };

  const scheduleTokenRefresh = (expiresIn) => {
    // Schedule refresh 5 minutes before expiration
    const refreshTime = (expiresIn - 300) * 1000;
    const timeout = setTimeout(async () => {
      try {
        await handleTokenRefresh();
      } catch (error) {
        setError('Failed to refresh session');
        logout();
      }
    }, refreshTime);

    setTokenRefreshTimeout(timeout);
    return timeout;
  };

  const handleTokenRefresh = async () => {
    try {
      const tokenData = await refreshSpotifyToken();
      
      // Validate token and get Cognito credentials
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
        throw new Error('Token validation failed');
      }

      const validationData = await validationResponse.json();
      setSpotifyToken(tokenData.access_token);

      // Update credentials
      const credentials = await getCredentials(validationData);
      setCredentials(credentials);
      
      // Store new expiration
      const expirationTime = Date.now() + (tokenData.expires_in * 1000);
      localStorage.setItem(STORAGE_KEYS.EXPIRATION, expirationTime.toString());

      // Schedule next refresh
      scheduleTokenRefresh(tokenData.expires_in);

      return true;
    } catch (error) {
      throw error;
    }
  };

  const restoreSession = async () => {
    try {
      const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      const expiration = localStorage.getItem(STORAGE_KEYS.EXPIRATION);
      const storedUserId = localStorage.getItem(STORAGE_KEYS.USER_ID);

      if (!refreshToken || !expiration || !storedUserId) {
        return false;
      }

      // Check if token needs immediate refresh
      const now = Date.now();
      const expirationTime = parseInt(expiration, 10);
      
      if (now >= expirationTime - 300000) { // If within 5 minutes of expiration
        await handleTokenRefresh();
      } else {
        // Schedule future refresh
        const timeUntilExpiry = Math.floor((expirationTime - now) / 1000);
        scheduleTokenRefresh(timeUntilExpiry);
      }

      setUserId(storedUserId);
      setIsAuthenticated(true);
      return true;
    } catch (error) {
      return false;
    }
  };

  const getCredentials = async (validationData) => {
    const identityId = validationData.identityId;
    const openIdToken = validationData.cognitoToken;

    const loginMap = {
      'cognito-identity.amazonaws.com': openIdToken
    };

    return await fromCognitoIdentity({
      client: cognitoIdentityClient,
      identityId: identityId,
      logins: loginMap
    });
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const sessionRestored = await restoreSession();
        if (!sessionRestored) {
          await checkAuthCode();
        }
      } catch (error) {
        setError('Failed to initialize authentication');
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    return () => {
      if (tokenRefreshTimeout) {
        clearTimeout(tokenRefreshTimeout);
      }
    };
  }, []);

  const checkAuthCode = async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    
    if (code) {
      const codeVerifier = sessionStorage.getItem('codeVerifier');
      if (codeVerifier) {
        try {
          sessionStorage.removeItem('codeVerifier');
          await handleCallback(code, codeVerifier);
        } catch (error) {
          console.error('Authentication failed');
          setError('Authentication failed');
        }
      }
      window.history.replaceState(
        {}, 
        document.title, 
        AUTH_CONFIG.spotify.baseUrl
      );
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      await checkAuthCode();
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const initiateLogin = () => {
    try {
      setError(null);
      
      const codeVerifier = generateRandomString(128);
      const codeChallenge = generateCodeChallenge(codeVerifier);
      
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
      setError('Failed to initiate login process');
    }
  };

  const handleCallback = async (code, codeVerifier) => {
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
        throw new Error('Token exchange failed');
      }

      const tokenData = await tokenResponse.json();
      
      // Store expiration time
      const expirationTime = Date.now() + (tokenData.expires_in * 1000);
      localStorage.setItem(STORAGE_KEYS.EXPIRATION, expirationTime.toString());

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
        throw new Error('Token validation failed');
      }

      const validationData = await validationResponse.json();
      setSpotifyToken(validationData.token);

      try {
        const credentials = await getCredentials(validationData);
        setCredentials(credentials);
        setIsAuthenticated(true);
        setUserId(validationData.userId);
        
        // Store user ID
        localStorage.setItem(STORAGE_KEYS.USER_ID, validationData.userId);

      } catch (error) {
        setError('Failed to obtain AWS credentials');
        throw error;
      }

      if (tokenData.refresh_token) {
        localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokenData.refresh_token);
      }

      // Schedule token refresh
      scheduleTokenRefresh(tokenData.expires_in);

    } catch (error) {
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
    
    // Clear all stored auth data
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.EXPIRATION);
    localStorage.removeItem(STORAGE_KEYS.USER_ID);
    sessionStorage.removeItem('codeVerifier');
    
    // Clear refresh timeout
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
    }
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
        logout
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