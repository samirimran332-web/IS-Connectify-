import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, getDocFromServer, Timestamp, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    // Initialize user profile if it doesn't exist
    const userRef = doc(db, 'users', result.user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        displayName: result.user.displayName || 'New User',
        email: result.user.email,
        photoURL: result.user.photoURL || '',
        bio: '',
        role: 'user',
        studentClass: '',
        department: 'None'
      });
    }
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

export const logout = () => signOut(auth);

export const updateProfile = async (uid: string, data: Partial<UserProfile>) => {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, data);
};

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

export interface NewsItem {
  id?: string;
  title: string;
  content: string;
  authorName: string;
  authorUid: string;
  createdAt: Timestamp;
  imageUrl?: string;
  isAiGenerated?: boolean;
}

export interface UserProfile {
  displayName: string;
  email: string;
  photoURL: string;
  bio: string;
  role: 'user' | 'admin';
  studentClass?: string;
  department?: 'Science' | 'Commerce' | 'Arts' | 'None';
}

export interface Task {
  id?: string;
  title: string;
  description?: string;
  dueDate?: Timestamp;
  completed: boolean;
  userId: string;
  createdAt: Timestamp;
}
