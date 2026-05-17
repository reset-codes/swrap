import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyBV76CgzUht2buscpWzHSl4_7-6aKvQvg4',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'sealbase-xyz.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'sealbase-xyz',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'sealbase-xyz.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '1050459499653',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:1050459499653:web:278a7886940f28fae40dec',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-V4N4MF1C7K',
};

// Initialize Firebase (prevent re-initialization in hot reload)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const firebaseAuth = getAuth(app);

export { app, firebaseAuth };
