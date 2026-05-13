import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBV76CgzUht2buscpWzHSl4_7-6aKvQvg4',
  authDomain: 'sealbase-xyz.firebaseapp.com',
  projectId: 'sealbase-xyz',
  storageBucket: 'sealbase-xyz.firebasestorage.app',
  messagingSenderId: '1050459499653',
  appId: '1:1050459499653:web:278a7886940f28fae40dec',
  measurementId: 'G-V4N4MF1C7K',
};

// Initialize Firebase (prevent re-initialization in hot reload)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const firebaseAuth = getAuth(app);

export { app, firebaseAuth };
