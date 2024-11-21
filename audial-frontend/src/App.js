// src/App.js
import React from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';

const LoginButton = () => {
  const { login } = useAuth();
  return (
    <button 
      onClick={login}
      className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
    >
      Login with Spotify
    </button>
  );
};

const UserProfile = () => {
  const { userId, logout } = useAuth();
  return (
    <div className="p-4">
      <h1 className="text-xl mb-4">Welcome, {userId}</h1>
      <button 
        onClick={logout}
        className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
      >
        Logout
      </button>
    </div>
  );
};

const AppContent = () => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <UserProfile /> : <LoginButton />;
};

function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <AppContent />
      </div>
    </AuthProvider>
  );
}

export default App;