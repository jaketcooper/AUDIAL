import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentity } from "@aws-sdk/credential-provider-cognito-identity";
import sha256 from 'crypto-js/sha256';
import Base64 from 'crypto-js/enc-base64';
import { CONFIG } from '../config/config';

const AuthContext = createContext(null);

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
  
  const tokenRefreshTimeoutRef = useRef(null);
  const cognitoClientRef = useRef(null);

  // Initialize Cognito client only once
  if (!cognitoClientRef.current) {
    cognitoClientRef.current = new CognitoIdentityClient({
      region: CONFIG.aws.region,
    });
  }

  const getCredentials = useCallback(async (validationData) => {
    const identityId = validationData.identityId;
    const openIdToken = validationData.cognitoToken;

    const loginMap = {
      'cognito-identity.amazonaws.com': openIdToken
    };

    return await fromCognitoIdentity({
      client: cognitoClientRef.current,
      identityId: identityId,
      logins: loginMap
    })();
  }, []);

  const refreshSpotifyToken = useCallback(async () => {
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
        client_id: CONFIG.spotify.clientId,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh token');
    }

    return await response.json();
  }, []);


  const scheduleTokenRefresh = useCallback((expiresIn) => {
    if (tokenRefreshTimeoutRef.current) {
      clearTimeout(tokenRefreshTimeoutRef.current);
    }

    const refreshTime = (expiresIn - 300) * 1000;
    tokenRefreshTimeoutRef.current = setTimeout(async () => {
      try {
        await handleTokenRefresh();
      } catch (error) {
        setError('Failed to refresh session');
        logout();
      }
    }, refreshTime);
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleTokenRefresh = useCallback(async () => {
    try {
      const tokenData = await refreshSpotifyToken();
      
      const validationResponse = await fetch(CONFIG.api.validateTokenEndpoint, {
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

      const credentials = await getCredentials(validationData);
      setCredentials(credentials);
      
      const expirationTime = Date.now() + (tokenData.expires_in * 1000);
      localStorage.setItem(STORAGE_KEYS.EXPIRATION, expirationTime.toString());

      scheduleTokenRefresh(tokenData.expires_in);

      return true;
    } catch (error) {
      throw error;
    }
  }, [getCredentials, refreshSpotifyToken, scheduleTokenRefresh]);

  const restoreSession = useCallback(async () => {
    try {
      const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      const expiration = localStorage.getItem(STORAGE_KEYS.EXPIRATION);
      const storedUserId = localStorage.getItem(STORAGE_KEYS.USER_ID);

      if (!refreshToken || !expiration || !storedUserId) {
        return false;
      }

      const now = Date.now();
      const expirationTime = parseInt(expiration, 10);
      
      if (now >= expirationTime - 300000) {
        await handleTokenRefresh();
      } else {
        const timeUntilExpiry = Math.floor((expirationTime - now) / 1000);
        scheduleTokenRefresh(timeUntilExpiry);
      }

      setUserId(storedUserId);
      setIsAuthenticated(true);
      return true;
    } catch (error) {
      return false;
    }
  }, [handleTokenRefresh, scheduleTokenRefresh]);

  const handleCallback = useCallback(async (code, codeVerifier) => {
    try {
      setError(null);
      setIsLoading(true);

      const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: CONFIG.spotify.clientId,
          grant_type: 'authorization_code',
          code,
          redirect_uri: CONFIG.spotify.redirectUri,
          code_verifier: codeVerifier,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Token exchange failed');
      }

      const tokenData = await tokenResponse.json();
      
      const expirationTime = Date.now() + (tokenData.expires_in * 1000);
      localStorage.setItem(STORAGE_KEYS.EXPIRATION, expirationTime.toString());

      const validationResponse = await fetch(CONFIG.api.validateTokenEndpoint, {
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

      const credentials = await getCredentials(validationData);
      setCredentials(credentials);
      setIsAuthenticated(true);
      setUserId(validationData.userId);
      
      localStorage.setItem(STORAGE_KEYS.USER_ID, validationData.userId);

      if (tokenData.refresh_token) {
        localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokenData.refresh_token);
      }

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
  }, [getCredentials, scheduleTokenRefresh]);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setCredentials(null);
    setSpotifyToken(null);
    setUserId(null);
    setError(null);
    
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.EXPIRATION);
    localStorage.removeItem(STORAGE_KEYS.USER_ID);
    sessionStorage.removeItem('codeVerifier');
    
    if (tokenRefreshTimeoutRef.current) {
      clearTimeout(tokenRefreshTimeoutRef.current);
      tokenRefreshTimeoutRef.current = null;
    }
  }, []);

  const initiateLogin = useCallback(() => {
    try {
      setError(null);
      
      const codeVerifier = generateRandomString(128);
      const codeChallenge = generateCodeChallenge(codeVerifier);
      
      sessionStorage.setItem('codeVerifier', codeVerifier);

      const params = new URLSearchParams({
        client_id: CONFIG.spotify.clientId,
        response_type: 'code',
        redirect_uri: CONFIG.spotify.redirectUri,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        scope: CONFIG.spotify.scopes,
      });

      window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
    } catch (error) {
      setError('Failed to initiate login process');
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        if (!mounted) return;
        
        const sessionRestored = await restoreSession();
        if (!mounted) return;
        
        if (!sessionRestored) {
          const params = new URLSearchParams(window.location.search);
          const code = params.get('code');
          
          if (code) {
            const codeVerifier = sessionStorage.getItem('codeVerifier');
            if (codeVerifier && mounted) {
              try {
                sessionStorage.removeItem('codeVerifier');
                await handleCallback(code, codeVerifier);
                if (mounted) {
                  window.history.replaceState(
                    {}, 
                    document.title, 
                    CONFIG.spotify.baseUrl
                  );
                }
              } catch (error) {
                if (mounted) {
                  setError('Authentication failed');
                }
              }
            }
          }
        }
      } catch (error) {
        if (mounted) {
          setError('Failed to initialize authentication');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      mounted = false;
      if (tokenRefreshTimeoutRef.current) {
        clearTimeout(tokenRefreshTimeoutRef.current);
      }
    };
  }, [handleCallback, restoreSession]);

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