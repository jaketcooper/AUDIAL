// src/auth/AuthProvider.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";

const AuthContext = createContext(null);

// Configuration
const AUTH_CONFIG = {
  spotify: {
    clientId: '3226c7189a0b403c9daf846e26cd1221',
    scopes: 'user-read-private user-read-email streaming',
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

// Generate random string for PKCE
const generateRandomString = (length) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
};

// Generate code challenge from verifier
const generateCodeChallenge = async (codeVerifier) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [spotifyToken, setSpotifyToken] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initialize AWS Cognito Identity client
  const cognitoIdentityClient = new CognitoIdentityClient({
    region: AUTH_CONFIG.aws.region,
  });

  useEffect(() => {
    // Check URL for auth code on component mount
    checkAuthCode().finally(() => {
      setIsLoading(false);
    });
  }, []);

  const checkAuthCode = async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    
    if (code) {
      // Get code verifier from session storage
      const codeVerifier = sessionStorage.getItem('codeVerifier');
      if (codeVerifier) {
        try {
          await handleCallback(code, codeVerifier);
        } catch (error) {
          console.error('Auth callback error:', error);
          setError(error.message);
        }
      }
      // Clean up URL while preserving the base path
      window.history.replaceState(
        {}, 
        document.title, 
        AUTH_CONFIG.spotify.baseUrl
      );
    }
  };

  const initiateLogin = async () => {
    try {
      setError(null);
      // PKCE: Generate code verifier and challenge
      const codeVerifier = generateRandomString(64);
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      
      // Store code verifier for later use
      sessionStorage.setItem('codeVerifier', codeVerifier);

      // Spotify OAuth parameters
      const params = new URLSearchParams({
        client_id: AUTH_CONFIG.spotify.clientId,
        response_type: 'code',
        redirect_uri: AUTH_CONFIG.spotify.redirectUri,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        scope: AUTH_CONFIG.spotify.scopes,
      });

      // Redirect to Spotify login
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

      // Get AWS credentials using Spotify token
      const credentials = await fromCognitoIdentityPool({
        client: cognitoIdentityClient,
        identityPoolId: AUTH_CONFIG.aws.identityPoolId,
        logins: {
          'spotify.com': tokenData.access_token
        }
      })();

      setCredentials(credentials);
      setIsAuthenticated(true);

      // Get user profile
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

  const refreshSession = async () => {
    const refreshToken = localStorage.getItem('spotify_refresh_token');
    if (!refreshToken) {
      return false;
    }

    try {
      // Implement refresh token logic here
      // This would be similar to handleCallback but using the refresh_token grant type
      return true;
    } catch (error) {
      console.error('Session refresh error:', error);
      return false;
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