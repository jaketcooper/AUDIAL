import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    region: 'us-east-1',
    userPoolId: 'us-east-1_O7pO614DE',
    userPoolWebClientId: '307v79k3fppf8kseh4qsbg6v4i', // Using the Web client ID
    oauth: {
      domain: 'sso-audial.auth.us-east-1.amazoncognito.com',
      scope: [
        'email', 
        'profile', 
        'openid', 
        'playlist-read-private', 
        'playlist-read-collaborative', 
        'streaming'
      ],
      redirectSignIn: 'http://localhost:3000/',
      redirectSignOut: 'http://localhost:3000/',
      responseType: 'code',
      providers: ['Spotify']
    }
  }
});

export const SpotifySignInButton = () => {
  const handleSignIn = async () => {
    try {
      await Auth.federatedSignIn({ provider: 'Spotify' });
    } catch (error) {
      console.error('Error signing in with Spotify:', error);
    }
  };

  return (
    <button onClick={handleSignIn}>
      Sign in with Spotify
    </button>
  );
};